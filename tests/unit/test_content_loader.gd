extends GutTest

const ContentLoader = preload("res://scripts/sim/content_loader.gd")

func test_first_rosters_load_and_validate_required_fields() -> void:
	var loader = ContentLoader.new()
	var buildings = loader.load_building_catalog()
	var drugs: Dictionary = loader.load_drugs()
	var abilities: Dictionary = loader.load_abilities()

	assert_eq(buildings.definitions.size(), 4)
	assert_eq(drugs.size(), 3)
	assert_eq(abilities.size(), 3)
	assert_eq(loader.validate_runtime_definition(buildings.get_definition("flag_workshop"), ["id", "lore_name", "cost_flags", "cost_attention", "effect_key"]).size(), 0)
	assert_eq(loader.validate_runtime_definition(drugs["saffron"].to_runtime_definition(), ["id", "lore_name", "duration_ticks", "benefit_key", "risk_key"]).size(), 0)
	assert_eq(loader.validate_runtime_definition(abilities["priority_beacon"].to_runtime_definition(), ["id", "lore_name", "cost_attention", "cooldown_ticks", "effect_key"]).size(), 0)


func test_runtime_catalogs_do_not_mutate_source_resources() -> void:
	var loader = ContentLoader.new()
	var catalog_a = loader.load_building_catalog()
	var catalog_b = loader.load_building_catalog()
	var source = load("res://resources/buildings/flag_workshop.tres")

	catalog_a.definitions["flag_workshop"].cost_attention = 99

	assert_eq(source.cost_attention, 2)
	assert_eq(catalog_b.definitions["flag_workshop"].cost_attention, 2)
