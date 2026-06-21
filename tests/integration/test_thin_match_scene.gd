extends GutTest

func test_scene_loads_fixed_fixture_entities() -> void:
	var scene = _fixture_scene()

	assert_eq(scene.rendered_entities.map_cells, GameConstants.MAP_WIDTH * GameConstants.MAP_HEIGHT)
	assert_eq(scene.rendered_entities.factions, 4)
	assert_gte(scene.rendered_entities.hippies, 4)
	assert_true(scene.rendered_entities.has("rival_hearth"))


func test_player_order_submission_places_flag_and_updates_overlay() -> void:
	var scene = _fixture_scene()
	var target_cell: Vector2i = scene.player_pattern.target_cells()[0]
	var flag_id: String = scene.claim_player_flag()

	var result: Dictionary = scene.place_player_flag(flag_id, target_cell)

	assert_true(result.ok)
	assert_eq(scene.order_history.size(), 1)
	assert_true(scene.pattern_overlay.fulfilled_cells.has(target_cell))
	assert_eq(scene.state.flags[flag_id].cell, target_cell)


func test_invalid_flag_placement_does_not_change_overlay() -> void:
	var scene = _fixture_scene()
	var before: Array = scene.pattern_overlay.fulfilled_cells.duplicate()

	var result: Dictionary = scene.place_player_flag("missing", scene.player_pattern.target_cells()[0])

	assert_false(result.ok)
	assert_eq(scene.pattern_overlay.fulfilled_cells, before)


func test_hearth_capture_feedback_becomes_visible_after_ticks() -> void:
	var scene = _fixture_scene()
	for target_cell in scene.player_pattern.target_cells():
		var flag_id: String = scene.claim_player_flag()
		scene.place_player_flag(flag_id, target_cell)

	scene.advance_ticks(1)

	assert_eq(scene.pattern_overlay.capture_state.state, "contained")
	assert_eq(scene.pattern_overlay.capture_state.attacker_faction_id, "player")


func test_camera_and_command_mode_leave_capture_feedback_available() -> void:
	var scene = _fixture_scene()
	scene.selection_controller.enter_command_mode("survey")
	scene.set_camera_cell(Vector2i(8, 8))

	assert_eq(scene.selection_controller.command_mode, "survey")
	assert_true(scene.pattern_overlay.visible)
	assert_eq(scene.camera_cell, Vector2i(8, 8))


func _fixture_scene():
	var packed_scene: PackedScene = load("res://scenes/match/match.tscn")
	var scene = packed_scene.instantiate()
	add_child_autofree(scene)
	scene.setup_fixture("thin-seed")
	return scene
