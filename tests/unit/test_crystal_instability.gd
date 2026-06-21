extends GutTest

const SurveyPattern = preload("res://scripts/sim/survey_pattern.gd")
const SurveyGeometryService = preload("res://scripts/sim/survey_geometry_service.gd")
const CrystalInstability = preload("res://scripts/sim/crystal_instability.gd")

func test_overlap_creates_bounded_instability_with_faction_attribution() -> void:
	var player = _fulfilled_box("player", Vector2i(2, 2), Vector2i(7, 7))
	var rival = _fulfilled_box("rival_surveyor", Vector2i(5, 5), Vector2i(10, 10))
	var instability = CrystalInstability.new()
	var geometry = SurveyGeometryService.new()

	var events: Array[Dictionary] = instability.update([player, rival], geometry, 1)

	assert_eq(events.size(), 1)
	assert_true(events[0].factions.has("player"))
	assert_true(events[0].factions.has("rival_surveyor"))
	assert_between(events[0].intensity, 0.0, 1.0)
	assert_gt(instability.work_modifier_for_cell(Vector2i(6, 6)), 0.0)


func test_instability_decays_after_overlap_resolves() -> void:
	var player = _fulfilled_box("player", Vector2i(2, 2), Vector2i(7, 7))
	var rival = _fulfilled_box("rival_surveyor", Vector2i(5, 5), Vector2i(10, 10))
	var instability = CrystalInstability.new()
	var geometry = SurveyGeometryService.new()
	instability.update([player, rival], geometry, 1)

	rival.vertices.clear()
	var events: Array[Dictionary] = instability.update([player, rival], geometry, 2)

	assert_eq(events.size(), 0)
	assert_lt(instability.work_modifier_for_cell(Vector2i(6, 6)), 1.0)


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
