cmake_minimum_required(VERSION 3.14)
set(PROJECT_NAME "liminal_remote_desktop")
project(${PROJECT_NAME} LANGUAGES CXX)

set(PLUGIN_NAME "liminal_remote_desktop_plugin")

add_library(${PLUGIN_NAME} SHARED
  "liminal_remote_desktop_plugin.cpp"
)

apply_standard_settings(${PLUGIN_NAME})
set_target_properties(${PLUGIN_NAME} PROPERTIES CXX_VISIBILITY_PRESET hidden)
target_compile_definitions(${PLUGIN_NAME} PRIVATE FLUTTER_PLUGIN_IMPL)
target_include_directories(${PLUGIN_NAME} PUBLIC
  "${CMAKE_CURRENT_SOURCE_DIR}"
  "${CMAKE_CURRENT_SOURCE_DIR}/include"
)
target_link_libraries(${PLUGIN_NAME} PRIVATE flutter flutter_wrapper_plugin)

set(liminal_remote_desktop_bundled_libraries
  ""
  PARENT_SCOPE
)
