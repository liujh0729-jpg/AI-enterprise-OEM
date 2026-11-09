/**
 * ESP32 最小示例：连 WiFi → 心跳 → 处理「指令下发」工具 → 回执。
 *
 * 使用前把下面 4 个宏改成你自己的值，然后：
 *   idf.py set-target esp32
 *   idf.py build flash monitor
 *
 * 工具里的「指令编码 commandCode」要与下方 command_handler 里的字符串一致。
 */

#include <string.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "nvs_flash.h"
#include "driver/gpio.h"
#include "cJSON.h"
#include "aiworkin_hardware.h"

#define WIFI_SSID     "your-wifi-ssid"
#define WIFI_PASS     "your-wifi-password"
#define SERVER_URL    "https://your-site.example.com"
#define DEVICE_TOKEN  "hw_xxxxxxxxxxxxxxxx"

#define LED_GPIO      GPIO_NUM_2

static const char *TAG = "quickstart";
static EventGroupHandle_t s_wifi_events;
#define WIFI_CONNECTED_BIT BIT0

static void wifi_event_handler(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    (void)arg;
    (void)data;
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        ESP_LOGW(TAG, "WiFi 断开，重连中");
        esp_wifi_connect();
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        xEventGroupSetBits(s_wifi_events, WIFI_CONNECTED_BIT);
    }
}

static void wifi_init_sta(void)
{
    s_wifi_events = xEventGroupCreate();
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t init_cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&init_cfg));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &wifi_event_handler, NULL));

    wifi_config_t wifi_config = { 0 };
    strncpy((char *)wifi_config.sta.ssid, WIFI_SSID, sizeof(wifi_config.sta.ssid) - 1);
    strncpy((char *)wifi_config.sta.password, WIFI_PASS, sizeof(wifi_config.sta.password) - 1);

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    xEventGroupWaitBits(s_wifi_events, WIFI_CONNECTED_BIT, pdFALSE, pdTRUE, portMAX_DELAY);
    ESP_LOGI(TAG, "WiFi 已连接");
}

/** 指令处理：返回 true 表示成功，结果写进 result 对象。 */
static bool command_handler(const char *tool_command_code, const cJSON *args, cJSON *result)
{
    if (strcmp(tool_command_code, "READ_STATUS") == 0) {
        cJSON_AddNumberToObject(result, "uptime_ms", (double)(esp_timer_get_time() / 1000));
        return true;
    }
    if (strcmp(tool_command_code, "SET_LED") == 0) {
        const cJSON *on = cJSON_GetObjectItem(args, "on");
        int level = 0;
        if (cJSON_IsBool(on)) {
            level = cJSON_IsTrue(on) ? 1 : 0;
        } else if (cJSON_IsNumber(on)) {
            level = on->valueint ? 1 : 0;
        }
        gpio_set_level(LED_GPIO, level);
        cJSON_AddBoolToObject(result, "on", level ? true : false);
        return true;
    }
    return false;
}

void app_main(void)
{
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    gpio_reset_pin(LED_GPIO);
    gpio_set_direction(LED_GPIO, GPIO_MODE_OUTPUT);

    wifi_init_sta();

    aiworkin_config_t cfg = {
        .server_url = SERVER_URL,
        .device_token = DEVICE_TOKEN,
        .firmware_version = "esp32-1.0.0",
        .report_base_url = "",  // 仅「设备直连（HTTP）」工具需要
        .heartbeat_interval_sec = 30,
    };
    ESP_ERROR_CHECK(aiworkin_hardware_start(&cfg, command_handler));
}
