import runpy
import sys
import traceback

log, script, *args = sys.argv[1:]
with open(log, 'w', buffering=1) as stream:
    sys.stdout = stream
    sys.stderr = stream
    try:
        module = runpy.run_path(script, run_name='round3_trellis_export')
        # M1 lacks float atomics used by Metal simplification. Pair this supported
        # non-remeshing path with --pre-cap 300000 --decimation-target 400000.
        module['DEMO_PARAMS']['remesh']['remesh'] = False
        print('Round 3 recovery override: remesh=False; same decoded checkpoint')
        code = module['main'](args)
    except Exception:
        traceback.print_exc()
        code = 1
    finally:
        sys.stdout = sys.__stdout__
        sys.stderr = sys.__stderr__
sys.exit(code)
