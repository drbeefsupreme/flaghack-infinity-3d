# Skeletal boss source asset

This is the approved rigged GLB, copied byte-for-byte from the 32 m source model.
The game loader now uses the complete hierarchy at its original scale of 1, giving a 32 m
hat-inclusive standing height without changing proportions, materials, or bones.
The original external source remains unchanged.

- 401,386 triangles; 594 material primitives from 587 source mesh objects
- 109 bones; normalized weights with at most four influences
- 31 original materials; no textures
- The loader merges compatible primitives by material into 31 skinned draws
- No decimation, remeshing, material substitutions, or added weapons
- The included jaw/grab/flap clip is a rig validation clip; the reveal keeps the
  existing rig for a crossed-arms ascent and a clock-sampled open-arm/head-back
  gesture, moving the complete rig uniformly during the ascent

The asset is intentionally stored in `public` so Vite and the host serve the same
binary. Tests parse it through Three's actual GLTFLoader, validate triangle,
topology, material, weight and joint preservation, and measure its resulting height.
The bounded cloth-only preparation exception below is checked separately.

## Runtime animation

The game applies deterministic standing/crouched locomotion, stance transitions,
swipes, stomps, grabbing/eating and the full death sequence to this same rig.
`crouchWalkData.ts` is sampled from the approved native Crouch_Walk action, with
forward root motion removed. The validation clip embedded in the GLB is not used
as a combat action. `bossHitPoseData.ts` contains numeric-only hit regions sampled
from the exact animated rig; its header records source hashes and coordinate rules.

This character was created for this project; no third-party character asset,
texture pack or animation library was added. The original authored source files
remain outside this runtime asset directory.

## Rear-drape attachment repair

The GLB remains byte-for-byte unchanged. To prevent the authored rear seam from
showing the skull through the cloth below the hat band, preparation applies a
small rearward corrective shape to exactly 1,174 vertices in seven named
rear-drape shell, lining, gold-bound edge and sewn-panel primitives. Maximum
movement is 0.18 source units (18 cm at the 32 m game scale), along Z only.
The original affected source-coordinate bounds are X −1.799090 to 1.798913,
Y 25.500854 to 26.613836, Z −1.614735 to −0.100583. Vertices outside this local
selection are bitwise unchanged. Normals are recomputed only on those drape
primitives; indices, weights, materials and bone count are unchanged. The repair
is idempotent and still consolidates into the same 31 draws.

The rear flap has no secondary physics or baked oscillation. Its upper control
keeps the original head-relative attachment. The lower control stretches and
bends toward a coat-relative anchor, with a flatter cross-section over the upper
back and extra deterministic clearance during deep head bends. The pose is
reapplied after eye aiming. Projectile regions are baked from this exact prepared
mesh and the same final poses, including the rear-drape deformation.
