extends GutTest

func test_generated_match_scene_instantiates_four_factions_and_placeholder_scenes() -> void:
	var scene = _generated_scene()

	assert_eq(scene.rendered_entities.factions, 4)
	assert_gte(scene.rendered_entities.hippies, 4)
	assert_true(ResourceLoader.exists("res://scenes/units/vexillomancer.tscn"))
	assert_true(ResourceLoader.exists("res://scenes/units/hippie.tscn"))
	assert_true(ResourceLoader.exists("res://scenes/units/flag.tscn"))
	assert_true(ResourceLoader.exists("res://scenes/buildings/flag_hearth.tscn"))


func test_building_ui_rejects_invalid_location_and_tracks_states() -> void:
	var scene = _generated_scene()
	var invalid: Dictionary = scene.place_building_from_ui("flag_workshop", Vector2i(-1, 0))
	assert_false(invalid.ok)
	assert_eq(invalid.error, "invalid_build_site")

	var placed: Dictionary = scene.place_building_from_ui("flag_workshop", Vector2i(6, 6))
	assert_true(placed.ok)
	scene.damage_building_for_ui(placed.building_id, 99)
	assert_true(scene.ui_state.buildings[placed.building_id].disabled)
	scene.repair_building_for_ui(placed.building_id, 99)
	assert_false(scene.ui_state.buildings[placed.building_id].disabled)


func test_drug_and_ability_ui_surface_duration_downside_and_cooldown() -> void:
	var scene = _generated_scene()
	var drug: Dictionary = scene.use_drug_from_ui("saffron")
	assert_true(drug.ok)
	assert_eq(scene.ui_state.drugs[0].risk_key, "overstimulation")
	assert_gt(scene.ui_state.drugs[0].expires_tick, scene.state.tick)

	var unlock: Dictionary = scene.unlock_ability_via_ritual("priority_beacon")
	assert_true(unlock.ok)
	var ability: Dictionary = scene.use_ability_from_ui("priority_beacon", Vector2i(7, 7))
	assert_true(ability.ok)
	assert_true(scene.ui_state.abilities.priority_beacon.cooldown_until > scene.state.tick)
	assert_eq(scene.use_ability_from_ui("priority_beacon", Vector2i(-1, 0)).error, "invalid_target")


func test_instability_visual_feedback_preserves_overlay_and_hud() -> void:
	var scene = _generated_scene()
	scene.trigger_instability_fixture()

	assert_gt(scene.pattern_overlay.instability_events.size(), 0)
	assert_true(scene.pattern_overlay.visible)
	assert_true(scene.hearth_capture_hud.is_readable())


func test_match_end_ui_appears_after_camp_conquest() -> void:
	var scene = _generated_scene()
	scene.state.capture_camp("camp_rival_surveyor", "player", 5)
	scene.state.capture_camp("camp_rival_brewer", "player", 6)
	scene.state.capture_camp("camp_rival_warden", "player", 7)
	scene.refresh_match_end()

	assert_true(scene.ui_state.match_end_visible)
	assert_eq(scene.ui_state.winner, "player")


func _generated_scene():
	var packed_scene: PackedScene = load("res://scenes/match/match.tscn")
	var scene = packed_scene.instantiate()
	add_child_autofree(scene)
	scene.setup_generated_match("scene-seed")
	return scene
