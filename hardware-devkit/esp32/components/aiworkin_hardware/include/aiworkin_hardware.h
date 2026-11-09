#pragma once

#include <stdbool.h>
#include "esp_err.h"
#include "cJSON.h"

#ifdef __cplusplus
extern "C" {
#endif

/** 设备通道配置。字符串在 start 时被复制，调用方无需长期持有。 */
typedef struct {
    /** 平台地址，如 "https://your-site.example.com"（不带 /api/...）。 */
    const char *server_url;
    /** 设备令牌 hw_...（页面「添加硬件」时拿到）。 */
    const char *device_token;
    /** 固件版本，随心跳上报。 */
    const char *firmware_version;
    /** 可选：本设备对外可访问的 HTTP 地址，供「设备直连（HTTP）」工具使用。 */
    const char *report_base_url;
    /** 心跳间隔秒，<=0 时按 30。 */
    int heartbeat_interval_sec;
} aiworkin_config_t;

/**
 * 指令处理函数：返回 true 表示执行成功。
 * tool_command_code 是工具里的 commandCode；args 可能是 NULL；result 是待填充的响应对象。
 */
typedef bool (*aiworkin_command_handler_t)(const char *tool_command_code, const cJSON *args, cJSON *result);

/**
 * 启动设备通道：内部创建任务，按间隔上报心跳、处理带回的指令并回执。
 * 需先连上 WiFi / 网络。成功返回 ESP_OK。
 */
esp_err_t aiworkin_hardware_start(const aiworkin_config_t *config, aiworkin_command_handler_t handler);

/** 停止设备通道（置停止标志，任务在本轮结束后自行退出）。 */
void aiworkin_hardware_stop(void);

#ifdef __cplusplus
}
#endif
