import {
  createDeterministicPhysicsWorld3D,
  stepDeterministicPhysicsWorld3D,
  applyDeterministicImpulses3D,
  stepDeterministicVehicle3D,
  deterministicPhysicsBodyById3D,
  type DeterministicVehicle3D,
} from '@series-inc/rundot-syncplay/creator';

const G = -9.8 / (30 * 30);
const wheel = (x: number, z: number, steered: boolean, driven: boolean) => ({
  localAnchor: { x, y: -0.2, z },
  suspensionDir: { x: 0, y: -1, z: 0 },
  suspensionRestLength: 0.5,
  suspensionMaxTravel: 0.3,
  radius: 0.35,
  stiffness: Number(process.env.K ?? 1),
  damping: Number(process.env.D ?? 0.1),
  grip: 1,
  maxSteerAngleTurns: 0.1,
  isSteered: steered,
  isDriven: driven,
});
const vehicle: DeterministicVehicle3D = {
  chassisId: 'car',
  wheels: [wheel(-0.6, 0.9, true, true), wheel(0.6, 0.9, true, true), wheel(-0.6, -0.9, false, true), wheel(0.6, -0.9, false, true)],
  driveForce: Number(process.env.F ?? 1),
  brakeForce: 1,
};
let world = createDeterministicPhysicsWorld3D([
  { id: 'ground', kind: 'static', x: 0, y: -0.5, z: 0, vx: 0, vy: 0, vz: 0, shape: { type: 'box', halfX: 200, halfY: 0.5, halfZ: 200 }, layer: 1, mask: 0xffffffff, material: { friction: Number(process.env.MU ?? 8), restitution: 0 } },
  { id: 'car', kind: 'dynamic', x: 0, y: 1.0, z: 0, vx: 0, vy: 0, vz: 0, mass: Number(process.env.M ?? 1200), orientation: { x: 0, y: 0, z: 0, w: 1 }, angularVel: { x: 0, y: 0, z: 0 }, linearDamping: 0.995, angularDamping: 0.95, shape: { type: 'box', halfX: 0.6, halfY: 0.3, halfZ: 1.1 }, layer: 2, mask: 0xffffffff },
]);
const steerAt = Number(process.env.STEER ?? 0);
for (let t = 0; t < 150; t++) {
  const input = { throttle: t > 30 ? 10 : 0, steer: t > 90 ? steerAt : 0, brake: 0 };
  const vr = stepDeterministicVehicle3D(vehicle, input, world);
  world = applyDeterministicImpulses3D(world, vr.impulses.map((i) => ({ bodyId: i.bodyId, impulse: i.impulse, worldPoint: i.point })));
  world = stepDeterministicPhysicsWorld3D(world, { gravityY: G, dtTicks: 1 }).world;
  if (t === 60 || t === 100) console.log(JSON.stringify(deterministicPhysicsBodyById3D(world, 'car')), JSON.stringify(vr.impulses.slice(0,1)));
  if (t % 15 === 0) {
    const b = deterministicPhysicsBodyById3D(world, 'car')!;
    console.log(t, 'pos', b.x.toFixed(2), b.y.toFixed(2), b.z.toFixed(2), 'v(m/s)', b.vx.toFixed(5), b.vy.toFixed(5), b.vz.toFixed(5), 'grounded', vr.wheels.filter((w) => w.grounded).length, 'q', b.orientation?.w.toFixed(3), b.orientation?.y.toFixed(3));
  }
}
