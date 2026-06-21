extends GutTest

const SurveyPattern = preload("res://scripts/sim/survey_pattern.gd")
const SurveyGeometryService = preload("res://scripts/sim/survey_geometry_service.gd")
const HearthCapture = preload("res://scripts/sim/hearth_capture.gd")

func test_contained_hearth_builds_capture_pressure() -> void:
	var pattern = _fulfilled_box("player", Vector2i(2, 2), Vector2i(6, 6))
	var capture = HearthCapture.new()
	var geometry = SurveyGeometryService.new()

	var state: Dictionary = capture.update_hearth("hearth_rival", Vector2i(4, 4), "rival", [pattern], geometry, 0, 1)

	assert_eq(state.state, "contained")
	assert_eq(state.attacker_faction_id, "player")
	assert_gt(state.pressure, 0.0)


func test_disruption_pushes_containment_back_to_contested() -> void:
	var pattern = _fulfilled_box("player", Vector2i(2, 2), Vector2i(6, 6))
	var capture = HearthCapture.new()
	var geometry = SurveyGeometryService.new()

	capture.update_hearth("hearth_rival", Vector2i(4, 4), "rival", [pattern], geometry, 0, 1)
	var disrupted: Dictionary = capture.update_hearth("hearth_rival", Vector2i(4, 4), "rival", [pattern], geometry, 5, 2)

	assert_eq(disrupted.state, "contested")
	assert_lt(disrupted.pressure, 0.5)


func test_capture_completes_when_pressure_reaches_threshold() -> void:
	var pattern = _fulfilled_box("player", Vector2i(2, 2), Vector2i(6, 6))
	var capture = HearthCapture.new()
	var geometry = SurveyGeometryService.new()
	capture.capture_threshold = 3.0

	var final_state := {}
	for tick in range(1, 5):
		final_state = capture.update_hearth("hearth_rival", Vector2i(4, 4), "rival", [pattern], geometry, 0, tick)

	assert_eq(final_state.state, "overwritten")
	assert_eq(final_state.attacker_faction_id, "player")


func test_simultaneous_attackers_resolve_to_highest_pressure() -> void:
	var weaker = _fulfilled_box("player", Vector2i(2, 2), Vector2i(6, 6))
	var stronger = _fulfilled_box("rival_brewer", Vector2i(1, 1), Vector2i(7, 7))
	var capture = HearthCapture.new()
	var geometry = SurveyGeometryService.new()
	capture.set_pressure("hearth_rival", "player", 2.0)
	capture.set_pressure("hearth_rival", "rival_brewer", 4.0)

	var state: Dictionary = capture.update_hearth("hearth_rival", Vector2i(4, 4), "rival", [weaker, stronger], geometry, 0, 10)

	assert_eq(state.attacker_faction_id, "rival_brewer")


func _fulfilled_box(faction_id: String, min_cell: Vector2i, max_cell: Vector2i):
	var pattern = SurveyPattern.from_cells(faction_id, [
		min_cell,
		Vector2i(max_cell.x, min_cell.y),
		max_cell,
		Vector2i(min_cell.x, max_cell.y),
	])
	for index in range(pattern.vertices.size()):
		pattern.vertices[index].fulfilled_by_flag_id = "%s_flag_%d" % [faction_id, index]
	return pattern
