extends GutTest

const BurnMapGenerator = preload("res://scripts/map/burn_map_generator.gd")

func test_fixed_seed_is_deterministic() -> void:
	var a = BurnMapGenerator.new().generate("burn-seed")
	var b = BurnMapGenerator.new().generate("burn-seed")

	assert_eq(a.summary_hash(), b.summary_hash())
	assert_eq(a.central_landmark_cell, b.central_landmark_cell)
	assert_eq(a.starting_camps, b.starting_camps)


func test_generated_map_has_four_reachable_corner_camps_and_center() -> void:
	var map = BurnMapGenerator.new().generate("burn-seed")

	assert_eq(map.starting_camps.size(), 4)
	assert_eq(map.central_landmark_cell, Vector2i(GameConstants.MAP_WIDTH / 2, GameConstants.MAP_HEIGHT / 2))
	for faction_id in map.starting_camps.keys():
		assert_true(map.cell_at(map.starting_camps[faction_id]).buildable)
		assert_true(map.is_reachable(map.starting_camps[faction_id], map.central_landmark_cell))


func test_starting_camps_have_comparable_buildable_area() -> void:
	var map = BurnMapGenerator.new().generate("burn-seed")
	var counts: Array[int] = []
	for start_cell in map.starting_camps.values():
		counts.append(map.count_buildable_near(start_cell, 3))
	counts.sort()

	assert_lte(counts.back() - counts.front(), 3)


func test_generated_survey_targets_are_reachable_and_buildable() -> void:
	var map = BurnMapGenerator.new().generate("burn-seed")
	for faction_id in map.starting_camps.keys():
		var pattern = map.pattern_for_faction(faction_id)
		for target_cell in pattern.target_cells():
			assert_true(map.is_in_bounds(target_cell))
			assert_true(map.cell_at(target_cell).buildable)
			assert_true(map.is_reachable(map.starting_camps[faction_id], target_cell))


func test_field_conditions_modify_work_without_blocking_all_paths() -> void:
	var map = BurnMapGenerator.new().generate("burn-seed")
	var muddy := 0
	var dusty := 0
	for cell in map.cells.values():
		if cell.field_condition == "mud":
			muddy += 1
			assert_gt(cell.work_modifier, 1.0)
		if cell.field_condition == "dust":
			dusty += 1
			assert_lt(cell.visibility_modifier, 1.0)
	assert_gt(muddy, 0)
	assert_gt(dusty, 0)
	assert_true(map.is_reachable(map.starting_camps["player"], map.starting_camps["rival_warden"]))
