"""Create a cumulative cell by copying guide data and applying style JSON."""
import argparse,json,shutil
from pathlib import Path
E=Path(__file__).resolve().parent
ap=argparse.ArgumentParser();ap.add_argument('tag');ap.add_argument('base');ap.add_argument('updates')
a=ap.parse_args();src=E/'cells'/a.base;dst=E/'cells'/a.tag;dst.mkdir(parents=True,exist_ok=True)
shutil.copy2(src/'guides16.npz',dst/'guides16.npz')
style=json.loads((src/'style.json').read_text());style.update(json.loads(a.updates));(dst/'style.json').write_text(json.dumps(style,indent=2)+'\n')
print(a.tag,json.dumps({k:style[k] for k in json.loads(a.updates)}))
