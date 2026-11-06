import math, itertools

def look_basis(cam, target):
    # three.js lookAt: z axis = normalize(eye - target); x = normalize(cross(up, z)); y = cross(z, x)
    f = (target[0]-cam[0], target[1]-cam[1], target[2]-cam[2])
    n = math.sqrt(sum(v*v for v in f)); f = tuple(v/n for v in f)
    # forward f, right = normalize(cross(f, up))
    up = (0,1,0)
    r = (f[1]*up[2]-f[2]*up[1], f[2]*up[0]-f[0]*up[2], f[0]*up[1]-f[1]*up[0])
    n = math.sqrt(sum(v*v for v in r)); r = tuple(v/n for v in r)
    u = (r[1]*f[2]-r[2]*f[1], r[2]*f[0]-r[0]*f[2], r[0]*f[1]-r[1]*f[0])
    return r, u, f

def ndc(cam, target, fov, aspect, p):
    r,u,f = look_basis(cam, target)
    d = (p[0]-cam[0], p[1]-cam[1], p[2]-cam[2])
    xc = sum(a*b for a,b in zip(d,r)); yc = sum(a*b for a,b in zip(d,u)); zc = sum(a*b for a,b in zip(d,f))
    if zc <= 0.001: return None
    tv = math.tan(math.radians(fov)/2)
    return (xc/zc/tv/aspect, yc/zc/tv, zc)

HALF=10.05
pts=[(x,y,z) for x in (-HALF,HALF) for z in (-HALF,HALF) for y in (-1.10,-0.26,0.0)]

def report(cam,target,fov,aspect,label):
    vals=[ndc(cam,target,fov,aspect,p) for p in pts]
    xs=[v[0] for v in vals]; ys=[v[1] for v in vals]
    left=-min(xs); right=max(xs); bottom=-min(ys); top=max(ys)   # distances from edges in NDC
    ok = max(xs)<=1 and min(xs)>=-1 and max(ys)<=1 and min(ys)>=-1
    print("%-26s x[%+.3f,%+.3f] y[%+.3f,%+.3f] margins L%.2f R%.2f B%.2f T%.2f %s"
          % (label, min(xs),max(xs),min(ys),max(ys), left,right,bottom,top, "OK" if ok else "CUT"))

for aspect in (1440/900, 16/9):
    print("=== aspect %.3f ===" % aspect)
    for cam,target,fov in [((0,26,16),(0,0,0),42), ((0,26,16),(0,-0.6,0),42), ((0,28,17),(0,-0.5,0),42),
                           ((0,30,18),(0,-0.5,0),42), ((0,26,17),(0,-0.4,0),42), ((0,29,16),(0,0,0),42),
                           ((0,27,19),(0,-0.5,0),42), ((0,25,17),(0,-0.3,0),44)]:
        report(cam,target,fov,aspect,"cam%s tgt%s fov%d"%(cam,target,fov))
