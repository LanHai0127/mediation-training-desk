import math

def basis(cam, target):
    f = [target[i]-cam[i] for i in range(3)]
    n = math.sqrt(sum(v*v for v in f)); f=[v/n for v in f]
    up=(0,1,0)
    r=[f[1]*up[2]-f[2]*up[1], f[2]*up[0]-f[0]*up[2], f[0]*up[1]-f[1]*up[0]]
    n=math.sqrt(sum(v*v for v in r)); r=[v/n for v in r]
    u=[r[1]*f[2]-r[2]*f[1], r[2]*f[0]-r[0]*f[2], r[0]*f[1]-r[1]*f[0]]
    return r,u,f

def ndc(cam,target,fov,aspect,p):
    r,u,f=basis(cam,target)
    d=[p[i]-cam[i] for i in range(3)]
    xc=sum(a*b for a,b in zip(d,r)); yc=sum(a*b for a,b in zip(d,u)); zc=sum(a*b for a,b in zip(d,f))
    tv=math.tan(math.radians(fov)/2)
    return xc/zc/tv/aspect, yc/zc/tv

HALF=10.05
pts=[(x,y,z) for x in (-HALF,HALF) for z in (-HALF,HALF) for y in (-1.10,-0.26,0.0)]
aspect=1440/900

def m(cam,target,fov):
    vals=[ndc(cam,target,fov,aspect,p) for p in pts]
    xs=[v[0] for v in vals]; ys=[v[1] for v in vals]
    return min(xs),max(xs),min(ys),max(ys)

print("cam z=16 y=26, vary look y (fov42)")
for ly in (0,-0.5,-1,-1.5,-2,-2.5):
    x0,x1,y0,y1=m((0,26,16),(0,ly,0),42)
    print(" look y %+.1f -> x[%+.2f,%+.2f] y[%+.2f,%+.2f] margins L%.2f R%.2f B%.2f T%.2f"%(ly,x0,x1,y0,y1,-x0,x1,-y0,y1))

print("cam z=17 y=28, vary look y (fov42)")
for ly in (-0.5,-1,-1.5,-2):
    x0,x1,y0,y1=m((0,28,17),(0,ly,0),42)
    print(" look y %+.1f -> y[%+.2f,%+.2f] margins B%.2f T%.2f L%.2f"%(ly,y0,y1,-y0,y1,-x0))

print("symmetric-ish search: want bottom margin ~= top margin ~0.2, x margin >= 0.25")
best=None
for cy in (24,25,26,27,28,29,30):
  for cz in (14,15,16,17,18,19,20):
    for ly in (0,-0.5,-1,-1.5,-2,-2.5,-3):
      for fov in (40,42,44,46):
        x0,x1,y0,y1=m((0,cy,cz),(0,ly,0),fov)
        if x0<-0.78 or x1>0.78 or y0<-0.78 or y1>0.78: continue  # >=22% margin all round
        bal=abs((-y0)-y1)
        score=bal + max(0, 0.35-(-x0))   # prefer balance and some side margin
        if best is None or score<best[0]:
            best=(score,cy,cz,ly,fov,x0,x1,y0,y1)
print("best:", best)
