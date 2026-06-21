extends GutTest

const MatchState = preload("res://scripts/sim/match_state.gd")
const BurnMapGenerator = preload("res://scripts/map/burn_map_generator.gd")
const SurveyGeometryService = preload("res://scripts/sim/survey_geometry_service.gd")
const HippieBrain = preload("res://scripts/sim/hippie_brain.gd")

func test_camp_expands_survey_pattern_through_hippie_automation() -> void:
	var state = MatchState.new_default("auto-seed")
	var map = BurnMapGenerator.new().generate("auto-seed")
	var pattern = map.pattern_for_faction("player")
	var target_cell: Vector2i = pattern.target_cells()[0]
	state.create_job("player", "survey", target_cell, 2, 1)

	var brain = HippieBrain.new()
	brain.tick_faction(state, "player", 2)
	SurveyGeometryService.new().refresh_pattern(pattern, state.flags)

	assert_true(pattern.vertices[0].is_fulfilled())
	assert_eq(state.factions["player"].flag_inventory, 5)
