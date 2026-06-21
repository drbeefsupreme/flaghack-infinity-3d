extends GutTest

const MatchState = preload("res://scripts/sim/match_state.gd")

func test_default_match_has_four_factions_and_hearths() -> void:
	var state = MatchState.new_default("seed-alpha")
	assert_eq(state.factions.size(), 4)
	assert_eq(state.camps.size(), 4)
	assert_eq(state.hearth_ids.size(), 4)
	assert_true(state.factions.has("player"))
	assert_true(state.factions.has("rival_surveyor"))
	assert_true(state.factions.has("rival_brewer"))
	assert_true(state.factions.has("rival_warden"))


func test_stable_ids_and_snapshot_have_no_scene_references() -> void:
	var state = MatchState.new_default("seed-alpha")
	var flag_id: String = state.claim_inventory_flag("player", "vex_player")
	assert_eq(flag_id, "flag_1")
	assert_eq(state.claim_inventory_flag("player", "vex_player"), "flag_2")

	var snapshot: Dictionary = state.snapshot()
	assert_false(_contains_object(snapshot))
	assert_true(JSON.stringify(snapshot).contains("flag_1"))


func test_seeded_replay_hash_is_deterministic_for_core_fields() -> void:
	var a = MatchState.new_default("seed-alpha")
	var b = MatchState.new_default("seed-alpha")

	var flag_a: String = a.claim_inventory_flag("player", "vex_player")
	var flag_b: String = b.claim_inventory_flag("player", "vex_player")
	a.place_carried_flag(flag_a, Vector2i(4, 4), 1)
	b.place_carried_flag(flag_b, Vector2i(4, 4), 1)

	assert_eq(a.state_hash(), b.state_hash())


func test_winner_detection_requires_single_active_hearth_owner() -> void:
	var state = MatchState.new_default("seed-alpha")
	assert_eq(state.winning_faction_id(), "")
	state.capture_camp("camp_rival_surveyor", "player", 10)
	state.capture_camp("camp_rival_brewer", "player", 11)
	state.capture_camp("camp_rival_warden", "player", 12)
	assert_eq(state.winning_faction_id(), "player")


func test_camp_capture_disables_buildings_and_neutralizes_hippies() -> void:
	var state = MatchState.new_default("capture-assets")
	var building_id: String = state.spawn_building("rival_surveyor", "flag_workshop", Vector2i(30, 4))
	var hippie_id: String = state.factions["rival_surveyor"].hippie_ids[0]
	state.capture_camp("camp_rival_surveyor", "player", 10)

	assert_eq(state.buildings[building_id].faction_id, "player")
	assert_true(state.buildings[building_id].disabled)
	assert_eq(state.buildings[building_id].hp, 0)
	assert_false(state.factions["rival_surveyor"].building_ids.has(building_id))
	assert_true(state.factions["player"].building_ids.has(building_id))
	assert_eq(state.hippies[hippie_id].faction_id, "")
	assert_false(state.hippies[hippie_id].active)
	assert_false(state.factions["rival_surveyor"].hippie_ids.has(hippie_id))


func test_new_assets_attach_to_nearest_owned_camp_after_capture() -> void:
	var state = MatchState.new_default("nearest-camp")
	state.capture_camp("camp_rival_surveyor", "player", 10)

	var building_id: String = state.spawn_building("player", "flag_workshop", Vector2i(35, 4))
	var hippie_id: String = state.spawn_hippie("player", Vector2i(35, 5))

	assert_true(state.camps["camp_rival_surveyor"].building_ids.has(building_id))
	assert_false(state.camps["camp_player"].building_ids.has(building_id))
	assert_true(state.camps["camp_rival_surveyor"].hippie_ids.has(hippie_id))
	assert_false(state.camps["camp_player"].hippie_ids.has(hippie_id))


func _contains_object(value: Variant) -> bool:
	if value is Object:
		return true
	if value is Dictionary:
		for key in value.keys():
			if _contains_object(value[key]):
				return true
	if value is Array:
		for entry in value:
			if _contains_object(entry):
				return true
	return false
