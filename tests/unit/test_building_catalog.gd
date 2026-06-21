extends GutTest

const MatchState = preload("res://scripts/sim/match_state.gd")
const ContentLoader = preload("res://scripts/sim/content_loader.gd")

func test_each_building_modifies_distinct_camp_capability() -> void:
	var state = MatchState.new_default("content-seed")
	var catalog = ContentLoader.new().load_building_catalog()

	var workshop: Dictionary = catalog.place_building(state, "player", "flag_workshop", Vector2i(5, 5))
	var recruits: Dictionary = catalog.place_building(state, "player", "recruitment_circle", Vector2i(6, 5))
	var ward: Dictionary = catalog.place_building(state, "player", "hearth_ward", Vector2i(7, 5))
	var lab: Dictionary = catalog.place_building(state, "player", "drug_lab", Vector2i(8, 5))

	assert_true(workshop.ok)
	assert_true(recruits.ok)
	assert_true(ward.ok)
	assert_true(lab.ok)
	assert_eq(state.factions["player"].camp_capabilities.flag_production, 2)
	assert_eq(state.factions["player"].camp_capabilities.recruitment, 1)
	assert_eq(state.factions["player"].camp_capabilities.hearth_defense, 3)
	assert_eq(state.factions["player"].camp_capabilities.drug_brewing, 1)


func test_invalid_or_insufficient_building_placement_rejects_without_spending() -> void:
	var state = MatchState.new_default("content-seed")
	var catalog = ContentLoader.new().load_building_catalog()
	state.factions["player"].attention_available = 0
	var before_flags: int = state.factions["player"].flag_inventory

	var result: Dictionary = catalog.place_building(state, "player", "flag_workshop", Vector2i(5, 5))

	assert_false(result.ok)
	assert_eq(result.error, "not_enough_attention")
	assert_eq(state.factions["player"].flag_inventory, before_flags)


func test_building_damage_disable_and_repair_changes_output() -> void:
	var state = MatchState.new_default("content-seed")
	var catalog = ContentLoader.new().load_building_catalog()
	var placed: Dictionary = catalog.place_building(state, "player", "hearth_ward", Vector2i(5, 5))
	var building_id: String = placed.building_id

	catalog.damage_building(state, building_id, 99)
	assert_true(state.buildings[building_id].disabled)
	assert_eq(state.factions["player"].camp_capabilities.hearth_defense, 0)

	catalog.repair_building(state, building_id, 99)
	assert_false(state.buildings[building_id].disabled)
	assert_eq(state.factions["player"].camp_capabilities.hearth_defense, 3)
