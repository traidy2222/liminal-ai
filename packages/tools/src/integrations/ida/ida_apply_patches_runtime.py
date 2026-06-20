# Standalone IDA script for py_eval fallback (ida_apply_patches_to_input companion tool).
# Expects globals: output_path (str), overwrite (bool).

import os
import shutil

import ida_bytes
import ida_nalt
import ida_segment
import idaapi
import idautils
import idc


def _default_output_path(input_path, output_path):
    if output_path and str(output_path).strip():
        return os.path.abspath(str(output_path).strip())
    base, ext = os.path.splitext(input_path)
    suffix = ext if ext else ".bin"
    return os.path.abspath(f"{base}.patched{suffix}")


def _byte_is_patched(ea):
    if hasattr(ida_bytes, "is_patched_byte"):
        try:
            return bool(ida_bytes.is_patched_byte(ea))
        except Exception:
            pass
    if hasattr(ida_bytes, "is_patched"):
        try:
            return bool(ida_bytes.is_patched(ea))
        except Exception:
            pass
    if hasattr(ida_bytes, "get_original_byte"):
        try:
            return ida_bytes.get_original_byte(ea) != ida_bytes.get_byte(ea)
        except Exception:
            pass
    return False


def _try_ida_loader_export(output_path):
    try:
        import ida_loader
    except ImportError:
        return False, "ida_loader unavailable"
    for attr in ("apply_patches_to_input_file", "save_patched_file"):
        fn = getattr(ida_loader, attr, None)
        if callable(fn):
            try:
                fn(output_path)
                return True, attr
            except TypeError:
                try:
                    fn()
                    return True, f"{attr}()"
                except Exception:
                    pass
            except Exception:
                pass
    gen = getattr(ida_loader, "gen_file", None)
    ofile_exe = getattr(ida_loader, "OFILE_EXE", None)
    if callable(gen) and ofile_exe is not None:
        try:
            flags = getattr(ida_loader, "GENFLG_AS_PACKED", 0)
            if gen(ofile_exe, output_path, 0, 0, flags):
                return True, "gen_file(OFILE_EXE)"
        except Exception:
            pass
    return False, "no loader export API"


def _manual_apply_patches(input_path, output_path):
    shutil.copy2(input_path, output_path)
    with open(output_path, "r+b") as f:
        patched = 0
        for seg_start in idautils.Segments():
            seg = ida_segment.getseg(seg_start)
            if seg is None:
                continue
            ea = seg.start_ea
            end = seg.end_ea
            while ea < end and ea != idaapi.BADADDR:
                if ida_bytes.is_loaded(ea) and _byte_is_patched(ea):
                    off = ida_bytes.get_fileregion_offset(ea)
                    if off not in (idaapi.BADADDR, idc.BADADDR, -1):
                        b = ida_bytes.get_byte(ea)
                        f.seek(off)
                        f.write(bytes([b]))
                        patched += 1
                ea = ida_bytes.next_addr(ea)
                if ea == idaapi.BADADDR:
                    break
        return patched


input_path = ida_nalt.get_input_file_path()
if not input_path:
    raise RuntimeError("No input file — open a binary with idb_open first.")
if not os.path.isfile(input_path):
    raise RuntimeError(f"Input file missing on disk: {input_path}")

out = _default_output_path(input_path, output_path)
if os.path.exists(out) and not overwrite:
    result = {
        "ok": False,
        "input_path": input_path,
        "output_path": out,
        "error": f"Output exists (set overwrite=true): {out}",
    }
else:
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    ok_loader, method = _try_ida_loader_export(out)
    if ok_loader:
        result = {
            "ok": True,
            "input_path": input_path,
            "output_path": out,
            "bytes_patched": -1,
            "method": method,
        }
    else:
        count = _manual_apply_patches(input_path, out)
        result = {
            "ok": True,
            "input_path": input_path,
            "output_path": out,
            "bytes_patched": count,
            "method": "manual_fileregion",
        }
result
