import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { makeAdb } from './session.mjs';

/** Read-only process and thermal snapshot; not per-frame CPU/GPU or a total browser RSS. */
export function nativeSnapshot(serial) {
  const adb = makeAdb(serial);
  const observations = {};
  for (const [name, args] of [
    ['systemMemory', ['shell', 'cat', '/proc/meminfo']],
    ['cpuPossible', ['shell', 'cat', '/sys/devices/system/cpu/possible']],
    ['socModel', ['shell', 'getprop', 'ro.soc.model']],
    ['browserPids', ['shell', 'pidof', 'com.oculus.browser']],
    ['processMap', ['shell', 'ps', '-A', '-o', 'PID,PPID,NAME']],
    ['browserMainProcessMemory', ['shell', 'dumpsys', 'meminfo', 'com.oculus.browser']],
    ['thermal', ['shell', 'dumpsys', 'thermalservice']],
    ['gpuProfilerPresent', ['shell', 'command', '-v', 'ovrgpuprofiler']],
    ['wifiInterface', ['shell', 'ip', '-4', 'addr', 'show', 'wlan0']],
  ]) {
    try { observations[name] = { status: 'measured', text: adb(...args) }; }
    catch (error) { observations[name] = { status: 'unavailable', reason: String(error).slice(0, 1500) }; }
  }
  return { schema: 'quest-capacity-native-observation.v1', at: new Date().toISOString(), serial, readOnly: true, scope: 'main-browser-process memory and device thermal snapshot; no frame timing, no process-total sum', observations, notEvidenceFor: ['compositor-frame-rate', 'GPU-per-frame', 'CPU-per-frame', 'total-browser-memory', 'thermal-sustainability'] };
}

/** Device-wide 1 Hz counters only; no detailed profiling mode or app restart. */
export async function gpuAggregateWindow(serial, seconds = 6) {
  if (!Number.isSafeInteger(seconds) || seconds < 2 || seconds > 10) throw new Error('GPU window bound 2..10s');
  makeAdb(serial); // Validate explicit serial before process creation.
  const at = new Date().toISOString();
  const args = ['-s', serial, 'shell', 'timeout', String(seconds), 'ovrgpuprofiler', '--realtime=2,3,4'];
  let result;
  try { const value = await promisify(execFile)(process.env.ADB_PATH || '/opt/homebrew/bin/adb', args, {timeout:(seconds+5)*1000,maxBuffer:100000,encoding:'utf8'}); result={exitCode:0,...value}; }
  catch(error) { result={exitCode:error.code,stdout:String(error.stdout||''),stderr:String(error.stderr||'').slice(0,2000)}; }
  return {schema:'quest-capacity-gpu-aggregate.v1',at,endedAt:new Date().toISOString(),serial,seconds,source:'ovrgpuprofiler realtime metrics 2,3,4',scope:'device-wide; all applications and compositor; un-attributed',granularity:'one-second-aggregate',profilingModeChanged:false,result,notEvidenceFor:['per-frame-GPU-duration','per-frame-percentiles','single-browser-GPU-ownership','compositor-presentation','maximum-capacity']};
}
