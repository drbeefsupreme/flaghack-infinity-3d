extends GutTest

const MatchState = preload("res://scripts/sim/match_state.gd")
const BurnMapGenerator = preload("res://scripts/map/burn_map_generator.gd")

func test_match_setup_applies_generated_corner_camps() -> void:
	var state = MatchState.new_default("burn-seed")
	var map = BurnMapGenerator.new().generate("burn-seed")
	map.apply_to_match_state(state)

	for faction_id in map.starting_camps.keys():
		var camp_id := "camp_%s" % faction_id
		assert_eq(state.camps[camp_id].cell, map.starting_camps[faction_id])
		assert_eq(state.camps[camp_id].faction_id, faction_id)
		assert_eq(state.factions[faction_id].flag_inventory, 6)
		assert_eq(state.factions[faction_id].hippie_ids.size(), 1)


func test_burn_map_scene_loads_without_owning_simulation_truth() -> void:
	var packed_scene: PackedScene = load("res://scenes/map/burn_map.tscn")
	assert_not_null(packed_scene)
	var scene: Node = packed_scene.instantiate()
	assert_true(scene.has_method("render_from_map"))
	scene.queue_free()
