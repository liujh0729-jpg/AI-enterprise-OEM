idf_component_register(
    SRCS "main.c"
    INCLUDE_DIRS "."
    REQUIRES aiworkin_hardware esp_timer driver nvs_flash esp_wifi esp_event esp_netif
)
