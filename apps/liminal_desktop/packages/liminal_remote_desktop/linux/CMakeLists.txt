cmake_minimum_required(VERSION 3.10)
set(PROJECT_NAME "liminal_remote_desktop")
project(${PROJECT_NAME} LANGUAGES CXX)

set(PLUGIN_NAME "liminal_remote_desktop_plugin")

add_library(${PLUGIN_NAME} SHARED
  "liminal_remote_desktop_plugin.cc"
)

apply_standard_settings(${PLUGIN_NAME})
set_target_properties(${PLUGIN_NAME} PROPERTIES CXX_VISIBILITY_PRESET hidden)
target_compile_definitions(${PLUGIN_NAME} PRIVATE FLUTTER_PLUGIN_IMPL)
target_include_directories(${PLUGIN_NAME} INTERFACE "${CMAKE_CURRENT_SOURCE_DIR}")
target_link_libraries(${PLUGIN_NAME} PRIVATE flutter X11 Xtst)
set(liminal_remote_desktop_bundled_libraries "" PARENT_SCOPE)
