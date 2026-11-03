import { createDeterministicPhysicsWorld3D, stepDeterministicPhysicsWorld3D, applyDeterministicImpulses3D, deterministicPhysicsBodyById3D } from '@series-inc/rundot-syncplay/creator';
let world = createDeterministicPhysicsWorld3D([
  { id: 'car', kind: 'dynamic', x: 0, y: 5, z: 0, vx: 0, vy: 0, vz: 0, mass: Number(process.env.M ?? 1200), orientation: { x: 0, y: 0, z: 0, w: 1 }, angularVel: { x: 0, y: 0, z: 0 }, shape: { type: 'box', halfX: 0.6, halfY: 0.3, halfZ: 1.1 }, layer: 2, mask: 0xffffffff },
]);
for (let t = 0; t < 6; t++) {
  world = applyDeterministicImpulses3D(world, [{ bodyId: 'car', impulse: { x: 0, y: 0, z: Number(process.env.I ?? 12) }, worldPoint: { x: 0, y: 5, z: 0 } }]);
  world = stepDeterministicPhysicsWorld3D(world, { gravityY: 0, dtTicks: 1 }).world;
  const b = deterministicPhysicsBodyById3D(world, 'car')!;
  console.log(t, 'z', b.z, 'vz', b.vz);
}
