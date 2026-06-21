extends GutTest

const FlagState = preload("res://scripts/sim/flag_state.gd")
const SurveyPattern = preload("res://scripts/sim/survey_pattern.gd")
const SurveyGeometryService = preload("res://scripts/sim/survey_geometry_service.gd")

func test_filling_target_vertex_marks_pattern_fulfilled() -> void:
	var pattern = SurveyPattern.from_cells("player", [
		Vector2i(2, 2),
		Vector2i(6, 2),
		Vector2i(6, 6),
		Vector2i(2, 6),
	])
	var flag = FlagState.new("flag_1", "player")
	flag.mark_placed(Vector2i(2, 2), 1)
	var geometry = SurveyGeometryService.new()

	geometry.refresh_pattern(pattern, {"flag_1": flag})

	assert_true(pattern.vertices[0].is_fulfilled())
	assert_eq(pattern.vertices[0].fulfilled_by_flag_id, "flag_1")
	assert_eq(pattern.fulfilled_cells().size(), 1)


func test_closed_region_contains_hearth_when_box_vertices_are_fulfilled() -> void:
	var pattern = SurveyPattern.from_cells("player", [
		Vector2i(2, 2),
		Vector2i(6, 2),
		Vector2i(6, 6),
		Vector2i(2, 6),
	])
	for index in range(pattern.vertices.size()):
		pattern.vertices[index].fulfilled_by_flag_id = "flag_%d" % index

	var geometry = SurveyGeometryService.new()
	assert_true(geometry.hearth_is_contained(pattern, Vector2i(4, 4)))
	assert_false(geometry.hearth_is_contained(pattern, Vector2i(8, 8)))


func test_scene_and_cell_coordinate_mapping_use_one_authority() -> void:
	var geometry = SurveyGeometryService.new()
	var cell := Vector2i(3, 5)
	var world: Vector2 = geometry.cell_to_scene(cell)
	assert_eq(geometry.scene_to_cell(world), cell)
	assert_eq(geometry.scene_to_cell(world + Vector2(9, 9)), cell)


func test_generated_patterns_are_distinct_by_seed_and_faction() -> void:
	var a = SurveyPattern.generated("player", Vector2i(4, 4), "map-seed")
	var b = SurveyPattern.generated("rival_surveyor", Vector2i(4, 4), "map-seed")
	var c = SurveyPattern.generated("player", Vector2i(4, 4), "other-seed")

	assert_ne(a.target_cells(), b.target_cells())
	assert_ne(a.target_cells(), c.target_cells())
