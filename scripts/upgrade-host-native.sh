#!/usr/bin/env bash
# Transient host root command. No service installation or policy changes.
set -euo pipefail
umask 077
operation="${1:-}"; if [ "$#" -gt 0 ]; then shift; fi
bundle=""; checksum=""; image=""; instance=""; approval=""; checkpoint=""
directory="/var/lib/slipway/upgrades"; container="slipway"; format=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = --ndjson ]; then format=--ndjson; shift; continue; fi
  if [ "$#" -lt 2 ] || [ -z "$2" ]; then exit 2; fi
  case "$1" in
    --bundle) bundle="$2" ;; --bundle-sha256) checksum="$2" ;; --image) image="$2" ;;
    --instance) instance="$2" ;; --approve-plan) approval="$2" ;; --checkpoint) checkpoint="$2" ;;
    --state-dir) directory="$2" ;; --container) container="$2" ;; *) exit 2 ;;
  esac
  shift 2
done
case "$operation" in verify|plan|apply|initialize|status|resume) ;; *) exit 2 ;; esac
if [ "$(id -u)" != 0 ] || [ "$(uname -s)" != Linux ] || [[ ! "$checksum" =~ ^[a-f0-9]{64}$ ]] || { [ "$operation" != verify ] && [[ ! "$image" =~ ^ghcr\.io/sailscastshq/slipway@sha256:[a-f0-9]{64}$ ]]; }; then
  printf '%s\n' '{"success":false,"code":"upgradeHostEnvironment"}' >&2; exit 2
fi
if { [ "$operation" = apply ] || [ "$operation" = resume ]; } && { [ -z "$instance" ] || [[ ! "$approval" =~ ^[a-f0-9]{64}$ ]]; }; then exit 2; fi
export SLIPWAY_NATIVE_BUNDLE="$bundle" SLIPWAY_NATIVE_SHA="$checksum" SLIPWAY_NATIVE_STATE="$directory"
extracted="$(python3 - <<'PY'
import os,sys,stat,hashlib,tarfile,tempfile,json,subprocess,platform,pathlib,shutil
try:
 archive=os.environ['SLIPWAY_NATIVE_BUNDLE']; expected=os.environ['SLIPWAY_NATIVE_SHA']; root=os.path.abspath(os.environ['SLIPWAY_NATIVE_STATE'])
 if os.path.realpath(root)!=root: raise ValueError()
 os.makedirs(root,mode=0o700,exist_ok=True)
 s=os.lstat(root)
 if not stat.S_ISDIR(s.st_mode) or s.st_uid!=0 or stat.S_IMODE(s.st_mode)!=0o700: raise ValueError()
 if os.stat(archive).st_size>256*1024*1024: raise ValueError()
 h=hashlib.sha256(); private=tempfile.TemporaryFile(dir=root); copied=0
 with open(archive,'rb') as f:
  for block in iter(lambda:f.read(1024*1024),b''):
   copied+=len(block)
   if copied>256*1024*1024: raise ValueError()
   h.update(block); private.write(block)
 if h.hexdigest()!=expected: raise ValueError()
 private.seek(0)
 dest=tempfile.mkdtemp(prefix='native-bundle-',dir=root)
 with tarfile.open(fileobj=private,mode='r:gz') as tf:
  members=tf.getmembers()
  if len(members)>10000 or sum(m.size for m in members)>256*1024*1024: raise ValueError()
  seen=set()
  for m in members:
   parts=pathlib.PurePosixPath(m.name).parts
   if m.name.startswith('/') or '..' in parts or not (m.isdir() or m.isfile()): raise ValueError()
   target=os.path.join(dest,*parts)
   if target in seen: raise ValueError()
   seen.add(target)
   if m.isdir(): os.makedirs(target,exist_ok=True,mode=0o700)
   else:
    os.makedirs(os.path.dirname(target),exist_ok=True,mode=0o700)
    with tf.extractfile(m) as source,open(target,'xb') as output: shutil.copyfileobj(source,output)
    os.chmod(target,0o755 if m.mode&0o100 else 0o644)
 private.close()
 manifest=json.load(open(os.path.join(dest,'host-manifest.json')))
 arch={'x86_64':'x64','aarch64':'arm64'}.get(platform.machine())
 libc=subprocess.run(['getconf','GNU_LIBC_VERSION'],capture_output=True,text=True,timeout=2,check=True).stdout.strip().split()[-1]
 numbers=lambda s:tuple(map(int,s.split('.')))
 if manifest['format']!=1 or manifest['platform']!='linux' or manifest['arch']!=arch or numbers(libc)<numbers(manifest['glibcMinimum']): raise ValueError()
 files={v['path']:v for v in manifest['files']}
 actual={str(p.relative_to(dest)) for p in pathlib.Path(dest).rglob('*') if p.is_file()}
 if actual!=set(files)|{'host-manifest.json'}: raise ValueError()
 for name,v in files.items():
  p=os.path.join(dest,name)
  if os.stat(p).st_size!=v['bytes'] or hashlib.sha256(open(p,'rb').read()).hexdigest()!=v['sha256']: raise ValueError()
 print(dest)
except Exception:
 if 'dest' in locals(): shutil.rmtree(dest,ignore_errors=True)
 print('{"success":false,"code":"upgradeHostBundle"}',file=sys.stderr); sys.exit(2)
PY
)"
cleanup() { rm -rf "$extracted"; }
trap cleanup EXIT
if ! env -i PATH=/usr/bin:/bin timeout --kill-after=2s 5s "$extracted/bin/node" -e 'const p=require(process.argv[1]+"/package.json"),m=require(process.argv[1]+"/host-manifest.json");if(p.version!==m.version||process.versions.modules!==m.modules||process.arch!==m.arch)process.exit(1);const d=new(require(process.argv[1]+"/node_modules/better-sqlite3"))(":memory:");if(d.pragma("integrity_check",{simple:true})!=="ok")process.exit(1);d.close()' "$extracted" >/dev/null 2>&1; then
  printf '%s\n' '{"success":false,"code":"upgradeHostAbi"}' >&2; exit 2
fi
if [ "$operation" = verify ]; then
  env -i "$extracted/bin/node" -e 'const m=require(process.argv[1]+"/host-manifest.json");console.log(JSON.stringify({success:true,version:m.version,arch:m.arch,sourceRevision:m.sourceRevision,nodeVersion:m.nodeVersion,glibcMinimum:m.glibcMinimum}))' "$extracted"
  exit 0
fi
export SLIPWAY_HOST_OPERATION="$operation" SLIPWAY_HOST_IMAGE="$image" SLIPWAY_HOST_INSTANCE="$instance" SLIPWAY_HOST_APPROVAL="$approval" SLIPWAY_HOST_CONTAINER="$container" SLIPWAY_HOST_CHECKPOINT="$checkpoint" SLIPWAY_HOST_DIRECTORY="$directory"
python3 - <<'PY' | env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin "$extracted/bin/node" "$extracted/scripts/upgrade-host-native.cjs" ${format:+"$format"}
import json,os
mapping={'operation':'OPERATION','image':'IMAGE','instanceId':'INSTANCE','approval':'APPROVAL','container':'CONTAINER','filename':'CHECKPOINT','directory':'DIRECTORY'}
print(json.dumps({k:os.environ['SLIPWAY_HOST_'+v] for k,v in mapping.items()}))
PY
