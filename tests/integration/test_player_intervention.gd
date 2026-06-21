extends GutTest

func test_player_can_select_and_move_vexillomancer_for_direct_intervention() -> void:
	var packed_scene: PackedScene = load("res://scenes/match/match.tscn")
	var scene = packed_scene.instantiate()
	add_child_autofree(scene)
	scene.setup_generated_match("intervention-seed")

	scene.select_vexillomancer("player")
	scene.move_selected_vexillomancer(Vector2i(9, 9))

	assert_eq(scene.selection_controller.selected_id, "vex_player")
	assert_eq(scene.vexillomancer_cells.player, Vector2i(9, 9))


func test_direct_intervention_can_reposition_flag_during_crisis() -> void:
	var packed_scene: PackedScene = load("res://scenes/match/match.tscn")
	var scene = packed_scene.instantiate()
	add_child_autofree(scene)
	scene.setup_generated_match("intervention-seed")
	var flag_id: String = scene.claim_player_flag()
	scene.place_player_flag(flag_id, scene.player_pattern.target_cells()[0])

	var pickup: Dictionary = scene.pickup_flag_for_intervention(flag_id)
	var place: Dictionary = scene.place_player_flag(flag_id, scene.player_pattern.target_cells()[1])

	assert_true(pickup.ok)
	assert_true(place.ok)
	assert_true(scene.pattern_overlay.fulfilled_cells.has(scene.player_pattern.target_cells()[1]))
