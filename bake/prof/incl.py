import json,glob,collections
f=sorted(glob.glob('bake/prof/*.cpuprofile'))[-1]
p=json.load(open(f))
nodes={n['id']:n for n in p['nodes']}
parent={}
for n in p['nodes']:
    for c in n.get('children',[]): parent[c]=n['id']
selfT=collections.Counter()
for s,d in zip(p['samples'],p['timeDeltas']): selfT[s]+=d
incl=collections.defaultdict(float)
for nid,t in selfT.items():
    seen=set(); cur=nid
    while cur is not None:
        fn=nodes[cur]['callFrame']['functionName'] or '(anon)'
        if fn not in seen:
            incl[fn]+=t; seen.add(fn)
        cur=parent.get(cur)
tot=sum(selfT.values())
want=['stepGame','stepDeterministicPhysicsWorld3D','runRigidSolver','solveRigidStep','stepDeterministicVehicle3D','applyDeterministicImpulses3D','applyDeterministicWorldEdit3D','applyDeterministicForces3D','createDeterministicPhysicsWorld3D','syncBuildings','deterministicPhysicsBodyById3D','computeHullMass','buildSolverHull','collideHulls','generateManifold','canonicalizeValue','defaultChecksum','(garbage collector)','projectGame','prepareMap','cellBody','hullChild','compound','buildSolverBody','computeShapeMassProperties','rayHullIntervalLocal','raycastDeterministicPhysics3D']
for k in want:
    if k in incl: print(f"{incl[k]/tot*100:5.1f}%  {k}")
