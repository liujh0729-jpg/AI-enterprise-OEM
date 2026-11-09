#include "aiworkin_hardware.h"

#include <stdio.h>
#include <string.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_http_client.h"
#include "esp_crt_bundle.h"

static const char *TAG = "aiworkin_hw";

static char s_server_url[192];
static char s_device_token[128];
static char s_firmware_version[64];
static char s_report_base_url[192];
static int s_interval = 30;
static volatile bool s_running = false;
static aiworkin_command_handler_t s_handler = NULL;

static void copy_str(char *dst, size_t size, const char *src)
{
    if (!src) {
        dst[0] = '\0';
        return;
    }
    strncpy(dst, src, size - 1);
    dst[size - 1] = '\0';
}

/** 发一个请求，把响应体读进 resp。返回 HTTP 状态码，网络失败返回 -1。 */
static int http_request(const char *method, const char *path, const char *body, char *resp, size_t resp_size)
{
    char url[512];
    snprintf(url, sizeof(url), "%s%s", s_server_url, path);

    esp_http_client_config_t cfg = {
        .url = url,
        .method = (strcmp(method, "GET") == 0) ? HTTP_METHOD_GET : HTTP_METHOD_POST,
        .timeout_ms = 15000,
        .crt_bundle_attach = esp_crt_bundle_attach,
        .disable_auto_redirect = true,
    };
    esp_http_client_handle_t client = esp_http_client_init(&cfg);
    if (!client) {
        return -1;
    }
    esp_http_client_set_header(client, "x-device-token", s_device_token);
    if (body) {
        esp_http_client_set_header(client, "content-type", "application/json");
        esp_http_client_set_post_field(client, body, (int)strlen(body));
    }

    esp_err_t err = esp_http_client_perform(client);
    int status = 0;
    if (err == ESP_OK) {
        status = esp_http_client_get_status_code(client);
        if (resp && resp_size) {
            size_t total = 0;
            while (total < resp_size - 1) {
                int n = esp_http_client_read(client, resp + total, (int)(resp_size - 1 - total));
                if (n <= 0) {
                    break;
                }
                total += (size_t)n;
            }
            resp[total] = '\0';
        }
    } else {
        ESP_LOGW(TAG, "%s %s 失败：%s", method, path, esp_err_to_name(err));
        if (resp && resp_size) {
            resp[0] = '\0';
        }
        status = -1;
    }
    esp_http_client_cleanup(client);
    return status;
}

/** 处理心跳带回的指令：逐条执行并回执。 */
static void process_commands(const char *resp)
{
    cJSON *root = cJSON_Parse(resp);
    if (!root) {
        return;
    }
    const cJSON *commands = cJSON_GetObjectItem(root, "commands");
    if (cJSON_IsArray(commands)) {
        const cJSON *cmd = NULL;
        cJSON_ArrayForEach(cmd, commands) {
            const cJSON *code = cJSON_GetObjectItem(cmd, "commandCode");
            const cJSON *tool = cJSON_GetObjectItem(cmd, "toolCommandCode");
            const cJSON *args = cJSON_GetObjectItem(cmd, "args");
            if (!cJSON_IsString(code) || !cJSON_IsString(tool)) {
                continue;
            }

            cJSON *result = cJSON_CreateObject();
            bool ok = s_handler ? s_handler(tool->valuestring, args, result) : false;

            cJSON *body = cJSON_CreateObject();
            cJSON_AddStringToObject(body, "commandCode", code->valuestring);
            cJSON_AddBoolToObject(body, "ok", ok);
            if (!ok) {
                cJSON_AddStringToObject(body, "message", "设备未实现或执行失败");
            }
            cJSON_AddItemToObject(body, "response", result);
            char *payload = cJSON_PrintUnformatted(body);
            cJSON_Delete(body);

            char ack[1024];
            int status = http_request("POST", "/api/public/hardware/result", payload, ack, sizeof(ack));
            if (status != 200) {
                ESP_LOGW(TAG, "回执失败：HTTP %d %s", status, ack);
            }
            cJSON_free(payload);
        }
    }
    cJSON_Delete(root);
}

static void hardware_task(void *arg)
{
    (void)arg;
    char resp[8192];
    while (s_running) {
        cJSON *root = cJSON_CreateObject();
        cJSON_AddStringToObject(root, "firmwareVersion", s_firmware_version);
        cJSON *meta = cJSON_AddObjectToObject(root, "meta");
        if (s_report_base_url[0]) {
            cJSON_AddStringToObject(meta, "baseUrl", s_report_base_url);
        }
        char *body = cJSON_PrintUnformatted(root);
        cJSON_Delete(root);

        int status = http_request("POST", "/api/public/hardware/heartbeat", body, resp, sizeof(resp));
        cJSON_free(body);
        if (status == 200) {
            process_commands(resp);
        } else {
            ESP_LOGW(TAG, "心跳失败：HTTP %d %s", status, resp);
        }

        for (int i = 0; i < s_interval && s_running; i++) {
            vTaskDelay(pdMS_TO_TICKS(1000));
        }
    }
    ESP_LOGI(TAG, "设备通道已停止");
    vTaskDelete(NULL);
}

esp_err_t aiworkin_hardware_start(const aiworkin_config_t *config, aiworkin_command_handler_t handler)
{
    if (!config || !config->server_url || !config->device_token) {
        return ESP_ERR_INVALID_ARG;
    }
    if (s_running) {
        return ESP_ERR_INVALID_STATE;
    }
    copy_str(s_server_url, sizeof(s_server_url), config->server_url);
    copy_str(s_device_token, sizeof(s_device_token), config->device_token);
    copy_str(s_firmware_version, sizeof(s_firmware_version), config->firmware_version);
    copy_str(s_report_base_url, sizeof(s_report_base_url), config->report_base_url);
    s_interval = config->heartbeat_interval_sec > 0 ? config->heartbeat_interval_sec : 30;
    s_handler = handler;
    s_running = true;

    if (xTaskCreate(hardware_task, "aiworkin_hw", 8192, NULL, 5, NULL) != pdPASS) {
        s_running = false;
        return ESP_ERR_NO_MEM;
    }
    ESP_LOGI(TAG, "设备通道已启动：%s（间隔 %ds）", s_server_url, s_interval);
    return ESP_OK;
}

void aiworkin_hardware_stop(void)
{
    s_running = false;
}
