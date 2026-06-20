# Standalone IDA script for py_eval fallback (ida_get_input_metadata companion tool).

import os

import ida_nalt
import idaapi

input_path = ida_nalt.get_input_file_path() or ""
idb_path = idaapi.get_path(idaapi.PATH_TYPE_IDB) or ""
module = idaapi.get_root_filename() or ""
imagebase = hex(idaapi.get_imagebase())
filesize = 0
is_pe = False
if input_path and os.path.isfile(input_path):
    filesize = os.path.getsize(input_path)
    is_pe = input_path.lower().endswith((".exe", ".dll", ".sys", ".ocx", ".scr"))
{
    "input_path": input_path,
    "idb_path": idb_path,
    "module": module,
    "imagebase": imagebase,
    "filesize": filesize,
    "is_pe": is_pe,
}
