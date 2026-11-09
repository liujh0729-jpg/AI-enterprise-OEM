idf_component_register(
    SRCS "aiworkin_hardware.c"
    INCLUDE_DIRS "include"
    REQUIRES esp_http_client json log
    PRIV_REQUIRES mbedtls
)
