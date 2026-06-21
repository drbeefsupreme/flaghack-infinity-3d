class_name SeedConfig
extends RefCounted

const MatchStateScript = preload("res://scripts/sim/match_state.gd")
const BurnMapGeneratorScript = preload("res://scripts/map/burn_map_generator.gd")
const SurveyPatternScript = preload("res://scripts/sim/survey_pattern.gd")
const SurveyGeometryServiceScript = preload("res://scripts/sim/survey_geometry_service.gd")
const CrystalInstabilityScript = preload("res://scripts/sim/crystal_instability.gd")
const HearthCaptureScript = preload("res://scripts/sim/hearth_capture.gd")

const FIXTURES := {
	"opening_growth": "flaghack-opening-growth",
	"pattern_collision": "pattern-collision",
	"hearth_containment": "hearth-containment",
	"match_end": "match-end",
}

static func available_fixtures() -> Array[String]:
	return FIXTURES.keys()


static func fixture(fixture_id: String) -> Dictionary:
	var seed: String = FIXTURES.get(fixture_id, GameConstants.DEFAULT_MATCH_SEED)
	var state: MatchState = MatchStateScript.new_default(seed)
	var burn_map: BurnMapGenerator = BurnMapGeneratorScript.new().generate(seed)
	burn_map.apply_to_match_state(state)
	var result := {
		"state": fixture_id,
		"seed": seed,
		"map_hash": burn_map.summary_hash(),
		"state_hash": state.state_hash(),
		"instability_events": [],
		"capture_state": {"state": "safe", "attacker_faction_id": "", "pressure": 0.0},
		"winner": "",
	}

	match fixture_id:
		"pattern_collision":
			result.instability_events = _collision_events()
		"hearth_containment":
			result.capture_state = _contained_state()
		"match_end":
			state.capture_camp("camp_rival_surveyor", "player", 1)
			state.capture_camp("camp_rival_brewer", "player", 2)
			state.capture_camp("camp_rival_warden", "player", 3)
			result.state_hash = state.state_hash()
			result.winner = state.winning_faction_id()
	return result


static func _collision_events() -> Array[Dictionary]:
	var geometry := SurveyGeometryServiceScript.new()
	var player := _fulfilled_box("player", Vector2i(2, 2), Vector2i(8, 8))
	var rival := _fulfilled_box("rival_surveyor", Vector2i(5, 5), Vector2i(11, 11))
	return CrystalInstabilityScript.new().update([player, rival], geometry, 1)


static func _contained_state() -> Dictionary:
	var geometry := SurveyGeometryServiceScript.new()
	var pattern := _fulfilled_box("player", Vector2i(2, 2), Vector2i(8, 8))
	return HearthCaptureScript.new().update_hearth("hearth_rival", Vector2i(4, 4), "rival_surveyor", [pattern], geometry, 0, 1)


static func _fulfilled_box(faction_id: String, min_cell: Vector2i, max_cell: Vector2i) -> SurveyPattern:
	var pattern: SurveyPattern = SurveyPatternScript.from_cells(faction_id, [
		min_cell,
		Vector2i(max_cell.x, min_cell.y),
		max_cell,
		Vector2i(min_cell.x, max_cell.y),
	])
	for index in range(pattern.vertices.size()):
		pattern.vertices[index].fulfilled_by_flag_id = "%s_fixture_%d" % [faction_id, index]
	return pattern
