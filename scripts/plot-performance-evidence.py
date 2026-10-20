"""Replot the synthetic before/after evidence. Requires matplotlib; no network."""
import json,pathlib,statistics,sys
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
root=pathlib.Path(__file__).resolve().parents[1]/'docs/performance-833'
plt.rcParams.update({'font.family':'DejaVu Sans','axes.spines.top':False,'axes.spines.right':False,'axes.titleweight':'bold','figure.facecolor':'white','axes.labelcolor':'#334155','text.color':'#0f172a','font.size':10})
colors=['#94a3b8','#0d9488']
def bars(ax,samples,key,scale,title,ylabel):
 for i,v in enumerate(['before','after']):
  vals=[r[key]/scale for r in samples if r['variant']==v]
  m=statistics.median(vals)
  ax.bar(i,m,color=colors[i],width=.6,zorder=2)
  ax.scatter([i+(j-3)*.025 for j in range(len(vals))],vals,color='#334155',s=13,zorder=3,alpha=.6)
  ax.annotate(f'{m:,.1f}',(i,max(vals)),xytext=(0,6),textcoords='offset points',ha='center',fontsize=10)
 ax.set_xticks([0,1],['Before','After']);ax.set_title(title,loc='left',fontsize=12,pad=14);ax.set_ylabel(ylabel);ax.grid(axis='y',alpha=.15,zorder=0);ax.set_ylim(0,ax.get_ylim()[1]*1.15)
def save(fig,name):
 for ext in ['png','svg']:fig.savefig(root/(name+'.'+ext),dpi=160,bbox_inches='tight')
 plt.close(fig)
x=json.loads((root/'floss-warning-raw.json').read_text())
fig,axs=plt.subplots(2,2,figsize=(10.6,7.6));fig.suptitle('Removing schema mismatch warnings from a real ORM read',fontsize=17,x=.06,ha='left',y=1.01)
for ax,k,scale,t,u in zip(axs.flat,['elapsedMs','cpuMs','maxRSSKiB','warningBytes'],[1,1,1024,1e6],['Elapsed time','Node CPU time','Process lifetime peak RSS','Generated warning output'],['ms / 10 reads','ms / 10 reads','MiB','MB / 10 reads']):bars(ax,x['samples'],k,scale,t,u)
fig.text(.06,-.04,'Seven alternating process pairs · 425 synthetic rows · ten identical PostgreSQL/Waterline reads per process\nDots: individual runs; bars: medians. Peak RSS includes Sails startup. No production latency/OOM claim.',fontsize=10,color='#475569');fig.tight_layout(h_pad=3,w_pad=3);save(fig,'floss-warning-before-after')
x=json.loads((root/'log-lines-raw.json').read_text());rows=[r for r in x['samples'] if r['lines']==89146 and r['width']==116]
fig,axs=plt.subplots(1,2,figsize=(10.6,4.1));fig.suptitle('Counting a burst without retaining every log line',fontsize=17,x=.06,ha='left',y=1.06)
bars(axs[0],rows,'cpuMs',1,'Node CPU time','ms / 10 counts');bars(axs[1],rows,'maxRSSKiB',1024,'Process lifetime peak RSS','MiB')
fig.text(.06,-.10,'Seven alternating process pairs · identical 89,146-line / 10.34 MB synthetic fixture\nIncludes Node/fixture memory; excludes Docker, redaction, SQLite and HTTP. Not a native crash fix.',fontsize=10,color='#475569');fig.tight_layout(w_pad=3);save(fig,'log-count-before-after')
print('wrote benchmark charts to',root)
# Retained records reconstruct registration/completion dates, not old memory/load.
import csv,datetime,matplotlib.dates as mdates
rows=list(csv.DictReader((root/'growth.csv').open()))
registered=sorted(datetime.datetime.fromisoformat(r['record_created_utc']) for r in rows)
completed=sorted(datetime.datetime.fromisoformat(r['earliest_retained_running_or_stopped_deployment_finished_utc']) for r in rows)
end=datetime.datetime(2026,10,20,tzinfo=datetime.timezone.utc)
fig,ax=plt.subplots(figsize=(10.6,4.5))
for dates,label,color in [(registered,'Retained app records','#0d9488'),(completed,'Earliest retained completed deployments','#64748b')]:
 ax.step(dates+[end],list(range(1,len(dates)+1))+[len(dates)],where='post',label=label,color=color,lw=2)
 ax.scatter(dates,list(range(1,len(dates)+1)),s=22,color=color,zorder=3)
ax.annotate('Three app records by 15 February',(registered[2],3),xytext=(12,-28),textcoords='offset points',fontsize=10)
ax.annotate('Nine app records; ten projects\nby 19 October',(end,9),xytext=(-175,28),textcoords='offset points',fontsize=10)
ax.set_title('Growth reconstructed from retained records',loc='left',fontsize=17,pad=42)
ax.set_ylabel('Cumulative count');ax.set_ylim(0,11);ax.set_yticks(range(0,11));ax.grid(axis='y',alpha=.15)
ax.xaxis.set_major_locator(mdates.MonthLocator(interval=1));ax.xaxis.set_major_formatter(mdates.DateFormatter('%b',tz=datetime.timezone.utc));ax.legend(loc='upper left',frameon=False)
fig.text(.08,-.06,'UTC · Records can omit deleted history. Deployment status is the retained running/stopped status.\nNo comparable CPU, RAM or traffic series survives from the early three-app period; no causal capacity threshold is inferred.',fontsize=9,color='#475569')
fig.tight_layout();save(fig,'fleet-growth')
