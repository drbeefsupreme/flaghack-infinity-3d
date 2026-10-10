# Skeletal boss source asset

This is the approved rigged GLB, copied byte-for-byte from the 32 m source model.
The game loader uniformly scales its complete hierarchy by 0.625, giving a 20 m
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
vertex, normal, weight and joint preservation, and measure its resulting height.

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
