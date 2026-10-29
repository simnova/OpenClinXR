import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const COLLECTOR = resolve(HERE, "ecg-input-bootstrap.py");

function repoRoot(): string {
  let cur = HERE;
  for (let i = 0; i < 14; i++) {
    if (existsSync(resolve(cur, "package.json")) && existsSync(resolve(cur, "tools"))) return cur;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  throw new Error("[ecg-test] cannot discover repo root from test file location");
}

function runPy(code: string, root: string): string {
  const loader = [
    "import importlib.util,sys",
    `spec=importlib.util.spec_from_file_location("ecg_input_bootstrap",${JSON.stringify(COLLECTOR)})`,
    "b=importlib.util.module_from_spec(spec);sys.modules['ecg_input_bootstrap']=b;spec.loader.exec_module(b)",
    code,
  ].join("\n");
  const python = process.env["PYTHON"] ?? "python3";
  return execFileSync(python, ["-c", loader], { encoding: "utf8", cwd: root });
}

// Tiny 8-file fixture setup shared by all fast unit cases. Writes canonical-
// schema freeze JSONs with correct per-fixture SHAs plus 8 tiny payload files
// into a unique temp root, so create_archive/materialize/preflight exercise
// the REAL production helpers without rebuilding the 48MB originals per case.
// Tiny fixtures are unit stand-ins only, never claimed as genuine ECG proof.
// Caller must shutil.rmtree(root) (try/finally).
const TINY_SETUP = [
  "import hashlib,json,os,shutil,tempfile",
  "root=tempfile.mkdtemp(prefix='ecg-tiny-')",
  "os.makedirs(root+'/tools/openclinxr/asset-pipeline/trellis',exist_ok=True)",
  "os.makedirs(root+'/tools/openclinxr/evidence/fixtures/ecg-controls',exist_ok=True)",
  "names=['tiny-raw.bin','tiny-c0.bin','tiny-c1.bin','tiny-m1.bin','front.png','side.png','three_quarter_left.png','three_quarter_right.png']",
  "stag='tinystage/2026-10-29T00-00-00Z'",
  "proot='.openclinxr/evidence/tinypack/pack-a'",
  "targets=[stag+'/'+names[0],stag+'/'+names[1],stag+'/'+names[2],stag+'/'+names[3],proot+'/ecg-cart/'+names[4],proot+'/ecg-cart/'+names[5],proot+'/ecg-cart/'+names[6],proot+'/ecg-cart/'+names[7]]",
  "shas={}",
  "raws={}",
  "[(shas.__setitem__(t,hashlib.sha256(('tiny:'+t).encode()).hexdigest()),raws.__setitem__(t,('tiny:'+t).encode())) for t in targets]",
  "c0={'schemaVersion':1,'plan':'tiny','note':'tiny unit fixture','stagingDir':stag,'raw':{'file':names[0],'sha256':shas[targets[0]]},'c0':{'file':names[1],'sha256':shas[targets[1]]},'c1':{'file':names[2],'sha256':shas[targets[2]]},'m1':{'file':names[3],'sha256':shas[targets[3]]},'renderer':'tiny','reportPath':'tiny','stills':[]}",
  "pa={'schemaVersion':1,'subjectId':'tiny','displayName':'tiny','seed':1,'seedDerivation':'tiny','remesh':'t','decimationTarget':1,'decimationTargetNote':'t','viewCount':4,'conditioning':'t','packRoot':proot,'packSource':'t','views':{names[4]:shas[targets[4]],names[5]:shas[targets[5]],names[6]:shas[targets[6]],names[7]:shas[targets[7]]},'controlRawSha256':shas[targets[0]],'controlRawTriangles':1,'notSubstituted':True,'outputDir':'t','claimScope':'tiny unit fixture only, not evidence for real ECG','notEvidenceFor':['real ECG']}",
  "open(root+'/tools/openclinxr/asset-pipeline/trellis/ecg-cart-c0-c1-control.json','w').write(json.dumps(c0))",
  "open(root+'/tools/openclinxr/asset-pipeline/trellis/ecg-cart-g1-pack-a-freeze.json','w').write(json.dumps(pa))",
  "src=root+'/tinysrc'",
  "os.makedirs(src+'/tools/openclinxr/asset-pipeline/trellis',exist_ok=True)",
  "[(os.makedirs(os.path.join(src,os.path.dirname(t)),exist_ok=True),open(os.path.join(src,t),'wb').write(raws[t])) for t in targets]",
  "shutil.copy(root+'/tools/openclinxr/asset-pipeline/trellis/ecg-cart-c0-c1-control.json',src+'/tools/openclinxr/asset-pipeline/trellis/')",
  "shutil.copy(root+'/tools/openclinxr/asset-pipeline/trellis/ecg-cart-g1-pack-a-freeze.json',src+'/tools/openclinxr/asset-pipeline/trellis/')",
  "os.environ.pop('OPENCLINXR_ECG_FIXTURE_ARCHIVE',None)",
].join("\n");

// Helper Python: build a tiny tar.gz archive (stdlib tarfile+gzip/BytesIO)
// from (name, kind, bytes) members against the current tiny expectation list.
const TINY_ARCH = [
  "import io,gzip,tarfile",
  "def tiny_tar_gz(members):",
  "    buf=io.BytesIO()",
  "    with tarfile.open(fileobj=buf,mode='w') as tf:",
  "        for name,kind,raw in members:",
  "            ti=tarfile.TarInfo(name=name)",
  "            ti.mtime=0;ti.mode=0o444;ti.uid=0;ti.gid=0;ti.uname='';ti.gname=''",
  "            if kind=='file':",
  "                ti.type=tarfile.REGTYPE;ti.size=len(raw)",
  "                tf.addfile(ti,io.BytesIO(raw))",
  "            elif kind=='symlink':",
  "                ti.type=tarfile.SYMTYPE;ti.linkname='tiny-elsewhere';ti.size=0",
  "                tf.addfile(ti)",
  "            elif kind=='dir':",
  "                ti.type=tarfile.DIRTYPE;ti.size=0",
  "                tf.addfile(ti)",
  "    out=io.BytesIO()",
  "    with gzip.GzipFile(filename='',mode='wb',compresslevel=9,mtime=0,fileobj=out) as gz:",
  "        gz.write(buf.getvalue())",
  "    return out.getvalue()",
].join("\n");

function tiny(script: string): string {
  return [TINY_SETUP, "try:", script.split("\n").map((l) => "    " + l).join("\n"), "finally:", "    shutil.rmtree(root,ignore_errors=True)"].join("\n");
}

describe("ecg-input-bootstrap (actual production collector)", () => {
  it("required_entries resolves 8 identities from canonical freezes", () => {
    const root = repoRoot();
    const out = runPy(
      `import json\nes=b.required_entries(${JSON.stringify(root)})\nprint(len(es))\nprint(json.dumps(sorted(e.target_repo_path for e in es)))`,
      root,
    );
    const [n, names] = out.trim().split("\n");
    expect(n).toBe("8");
    expect(JSON.parse(names)).toHaveLength(8);
  });

  it("create_archive packet; write outputs; cold8 then warm8", () => {
    const root = repoRoot();
    const script = tiny(
      [
        "built=b.create_archive(src,root)",
        "assert isinstance(built,dict) and 'archive_bytes' in built",
        "b.write_archive_outputs(root,built)",
        "r1=b.materialize(root)",
        "assert len(r1['restored'])==8,r1",
        "r2=b.materialize(root)",
        "assert r2['restored']==[] and len(r2['reused'])==8,r2",
        "print('OK '+str(len(r1['restored']))+'/'+str(len(r2['reused'])))",
      ].join("\n"),
    );
    expect(runPy(script, root).trim()).toBe("OK 8/8");
  });

  it("two real-clock-tick builds are byte-identical", () => {
    const root = repoRoot();
    const script = tiny(
      [
        "import time",
        "time.sleep(1.1)",
        "a=b.create_archive(src,root)['archive_bytes']",
        "time.sleep(1.1)",
        "c=b.create_archive(src,root)['archive_bytes']",
        "import hashlib",
        "print('EQ '+str(hashlib.sha256(a).hexdigest()==hashlib.sha256(c).hexdigest()))",
      ].join("\n"),
    );
    expect(runPy(script, root).trim()).toBe("EQ True");
  });

  it("late-8th different-bytes conflict refuses with zero writes", () => {
    const root = repoRoot();
    const script = tiny(
      [
        "built=b.create_archive(src,root)",
        "b.write_archive_outputs(root,built)",
        "exp=b.required_entries(root)",
        "os.makedirs(os.path.dirname(os.path.join(root,exp[7].target_repo_path)),exist_ok=True)",
        "open(os.path.join(root,exp[7].target_repo_path),'wb').write(b'WRONG')",
        "n0=sum(len(fs) for _,_,fs in os.walk(root))",
        "ref=0",
        "try:",
        "    b.materialize(root)",
        "except RuntimeError:",
        "    ref=1",
        "n1=sum(len(fs) for _,_,fs in os.walk(root))",
        "print('LATE '+str(ref)+' '+str(int(n0==n1)))",
      ].join("\n"),
    );
    expect(runPy(script, root).trim()).toBe("LATE 1 1");
  });

  it("refuses missing archive, wrong entry SHA, wrong member, symlink member, directory member", () => {
    const root = repoRoot();
    const script = tiny(
      [
        TINY_ARCH,
        "import dataclasses",
        "exp=b.required_entries(root)",
        "fails=0",
        "try:",
        "    b.preflight_archive(root+'/tools/openclinxr/evidence/fixtures/ecg-controls/ecg-frozen-inputs.tar.gz',exp,root)",
        "except RuntimeError:",
        "    fails=fails+1",
        "built=b.create_archive(src,root)",
        "b.write_archive_outputs(root,built)",
        "arch=root+'/tools/openclinxr/evidence/fixtures/ecg-controls/ecg-frozen-inputs.tar.gz'",
        "bad=list(exp)",
        "bad[0]=dataclasses.replace(bad[0],sha256='0'*64)",
        "try:",
        "    b.preflight_archive(arch,bad,root)",
        "except RuntimeError:",
        "    fails=fails+1",
        "ms=[(t,'file',raws[t]) for t in targets]",
        "ms[0]=(targets[0]+'-renamed','file',raws[targets[0]])",
        "open(arch,'wb').write(tiny_tar_gz(ms))",
        "try:",
        "    b.preflight_archive(arch,exp,root)",
        "except RuntimeError:",
        "    fails=fails+1",
        "ms=[(t,'file',raws[t]) for t in targets]",
        "ms[1]=(targets[1],'symlink',b'')",
        "open(arch,'wb').write(tiny_tar_gz(ms))",
        "try:",
        "    b.preflight_archive(arch,exp,root)",
        "except RuntimeError:",
        "    fails=fails+1",
        "ms=[(t,'file',raws[t]) for t in targets]",
        "ms[2]=(targets[2],'dir',b'')",
        "open(arch,'wb').write(tiny_tar_gz(ms))",
        "try:",
        "    b.preflight_archive(arch,exp,root)",
        "except RuntimeError:",
        "    fails=fails+1",
        "print('NEG '+str(fails))",
      ].join("\n"),
    );
    expect(runPy(script, root).trim()).toBe("NEG 5");
  });

  it("ancestor symlink refuses with zero outside writes (tiny 8 fixture)", () => {
    const root = repoRoot();
    const script = tiny(
      [
        "import hashlib",
        "built=b.create_archive(src,root)",
        "b.write_archive_outputs(root,built)",
        "exp=b.required_entries(root)",
        "leaf=exp[0].target_repo_path",
        "outside=tempfile.mkdtemp(prefix='ecg-out-')",
        "try:",
        "    anc=os.path.join(root,os.path.dirname(leaf).split('/')[0])",
        "    shutil.rmtree(anc,ignore_errors=True)",
        "    os.symlink(outside,anc)",
        "    def inv(d):",
        "        r={}",
        "        [r.update({os.path.join(dp,f):hashlib.sha256(open(os.path.join(dp,f),'rb').read()).hexdigest()}) for dp,_,fs in os.walk(d) for f in fs]",
        "        return r",
        "    before=inv(outside)",
        "    ref=0",
        "    try:",
        "        b.materialize(root)",
        "    except RuntimeError:",
        "        ref=1",
        "    after=inv(outside)",
        "    print('ANC '+str(ref)+' '+str(int(before==after and len(after)==0)))",
        "    os.unlink(anc)",
        "finally:",
        "    shutil.rmtree(outside,ignore_errors=True)",
      ].join("\n"),
    );
    expect(runPy(script, root).trim()).toBe("ANC 1 1");
  });

  it("wrong explicit store archive SHA refuses before any write", () => {
    const root = repoRoot();
    const script = tiny(
      [
        "built=b.create_archive(src,root)",
        "b.write_archive_outputs(root,built)",
        "arch=root+'/tools/openclinxr/evidence/fixtures/ecg-controls/ecg-frozen-inputs.tar.gz'",
        "sp=root+'/store-spoof.tar.gz'",
        "fh=open(sp,'wb');fh.truncate(b.EXPECTED_ARCHIVE_BYTES);fh.close()",
        "os.environ['OPENCLINXR_ECG_FIXTURE_ARCHIVE']=sp",
        "try:",
        "    n0=sum(len(fs) for _,_,fs in os.walk(root))+sum(len(fs) for _,_,fs in os.walk(os.path.dirname(sp)))",
        "    ref=0;msg=''",
        "    try:",
        "        b.materialize(root)",
        "    except RuntimeError as e:",
        "        ref=1;msg=str(e)",
        "    n1=sum(len(fs) for _,_,fs in os.walk(root))+sum(len(fs) for _,_,fs in os.walk(os.path.dirname(sp)))",
        "    assert 'wrong SHA256' in msg,msg",
        "    print('WARC '+str(ref)+' '+str(int(n0==n1)))",
        "finally:",
        "    os.environ.pop('OPENCLINXR_ECG_FIXTURE_ARCHIVE',None)",
        "    os.unlink(sp)",
      ].join("\n"),
    );
    expect(runPy(script, root).trim()).toBe("WARC 1 1");
  });

  it("warm without any archive reuses all 8 verified targets", () => {
    const root = repoRoot();
    const script = tiny(
      [
        "built=b.create_archive(src,root)",
        "b.write_archive_outputs(root,built)",
        "r1=b.materialize(root)",
        "assert len(r1['restored'])==8,r1",
        "os.unlink(root+'/tools/openclinxr/evidence/fixtures/ecg-controls/ecg-frozen-inputs.tar.gz')",
        "os.environ.pop('OPENCLINXR_ECG_FIXTURE_ARCHIVE',None)",
        "r2=b.materialize(root)",
        "assert r2['restored']==[] and len(r2['reused'])==8,r2",
        "print('WARM '+str(len(r2['reused'])))",
      ].join("\n"),
    );
    expect(runPy(script, root).trim()).toBe("WARM 8");
  });

  it("warm without archive but one file missing refuses", () => {
    const root = repoRoot();
    const script = tiny(
      [
        "built=b.create_archive(src,root)",
        "b.write_archive_outputs(root,built)",
        "r1=b.materialize(root)",
        "assert len(r1['restored'])==8,r1",
        "os.unlink(root+'/tools/openclinxr/evidence/fixtures/ecg-controls/ecg-frozen-inputs.tar.gz')",
        "exp=b.required_entries(root)",
        "os.unlink(os.path.join(root,exp[3].target_repo_path))",
        "os.environ.pop('OPENCLINXR_ECG_FIXTURE_ARCHIVE',None)",
        "ref=0",
        "try:",
        "    b.materialize(root)",
        "except RuntimeError:",
        "    ref=1",
        "print('WARMNEG '+str(ref))",
      ].join("\n"),
    );
    expect(runPy(script, root).trim()).toBe("WARMNEG 1");
  });
});
