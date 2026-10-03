/** Moving the Geomantic Command Center cart (pushed by a vexillomancer or a hippie). */
import { BUILDINGS, MAP_HALF } from '../../constants';
import { angleDiff, clamp, wrapAngle } from '../../math';
import type { Building } from '../../types';
import type { World } from '../../world';
import { moveBuilding } from '../buildings';

/** Vertical band checked for cart clearance (wheels to tabletop). */
const CART_Y0 = 0.15;
const CART_Y1 = 1.2;
/** How fast the cart swings round to face its push direction (rad/s). */
const CART_TURN_RATE = 3;

function cartFits(world: World, g: Building, x: number, z: number): boolean {
  const r = BUILDINGS.gcc.radius;
  const lim = MAP_HALF - r;
  if (Math.abs(x) > lim || Math.abs(z) > lim) return false;
  return !world.collision.blockedCircle(x, z, r, CART_Y0, CART_Y1, g.id);
}

/**
 * Move the cart to (x, z), sliding along one axis when the direct spot is blocked, and turn it
 * toward `faceYaw`. A cart already wedged in something may move freely to escape. Returns false
 * when it could not move at all.
 */
export function moveCart(world: World, g: Building, x: number, z: number, faceYaw: number, dt: number): boolean {
  let nx = x;
  let nz = z;
  if (cartFits(world, g, g.pos.x, g.pos.z) && !cartFits(world, g, nx, nz)) {
    if (cartFits(world, g, nx, g.pos.z)) nz = g.pos.z;
    else if (cartFits(world, g, g.pos.x, nz)) nx = g.pos.x;
    else return false;
  }
  const turn = CART_TURN_RATE * dt;
  g.yaw = wrapAngle(g.yaw + clamp(angleDiff(g.yaw, faceYaw), -turn, turn));
  moveBuilding(world, g, nx, nz);
  return true;
}
