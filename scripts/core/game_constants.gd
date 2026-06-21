extends Node

const GODOT_VERSION_BASELINE := "4.6-stable"
const GUT_VERSION_BASELINE := "9.6.0"

const CELL_SIZE := 32
const MAP_WIDTH := 40
const MAP_HEIGHT := 28
const MATCH_TICK_RATE := 10
const DEFAULT_MATCH_SEED := "flaghack-opening-growth"

const TEAM_COLORS := {
	"player": Color("#f3d23b"),
	"rival_surveyor": Color("#9c59d1"),
	"rival_brewer": Color("#67c7d4"),
	"rival_warden": Color("#d84b4b"),
}

const LORE_TERMS := {
	"flag": "Flag",
	"hearth": "Flag Hearth",
	"pattern": "Survey Pattern",
	"instability": "Crystal instability",
	"worker": "hippie",
	"caster": "vexillomancer",
}

static func cell_to_world(cell: Vector2i) -> Vector2:
	return Vector2(cell.x * CELL_SIZE + CELL_SIZE / 2, cell.y * CELL_SIZE + CELL_SIZE / 2)


static func world_to_cell(world_position: Vector2) -> Vector2i:
	return Vector2i(floori(world_position.x / CELL_SIZE), floori(world_position.y / CELL_SIZE))
