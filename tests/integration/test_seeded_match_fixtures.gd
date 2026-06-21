extends GutTest

const MatchState = preload("res://scripts/sim/match_state.gd")
const SeedConfig = preload("res://scripts/core/seed_config.gd")

func test_lore_terms_use_survey_flags_vocabulary() -> void:
	var terms = load("res://resources/text/lore_terms.tres")
	var all_text: String = JSON.stringify(terms.labels)

	assert_eq(terms.label("pattern"), "Survey Pattern")
	assert_eq(terms.label("hearth"), "Flag Hearth")
	assert_false(terms.contains_forbidden_terms(all_text))


func test_fixed_debug_seeds_are_reproducible() -> void:
	var opening_a = SeedConfig.fixture("opening_growth")
	var opening_b = SeedConfig.fixture("opening_growth")

	assert_eq(opening_a.seed, opening_b.seed)
	assert_eq(opening_a.map_hash, opening_b.map_hash)
	assert_eq(opening_a.state_hash, opening_b.state_hash)


func test_debug_overlay_toggles_do_not_change_simulation() -> void:
	var packed_scene: PackedScene = load("res://scenes/match/match.tscn")
	var scene = packed_scene.instantiate()
	add_child_autofree(scene)
	scene.setup_generated_match("debug-seed")
	var before_hash: String = scene.state.state_hash()

	scene.debug_overlay.set_layer_enabled("npc_intent", false)
	scene.debug_overlay.set_layer_enabled("capture_state", true)
	scene.debug_overlay.render_from(scene.state.snapshot())

	assert_eq(scene.state.state_hash(), before_hash)


func test_fixture_jump_points_cover_growth_collision_containment_and_match_end() -> void:
	var growth = SeedConfig.fixture("opening_growth")
	var collision = SeedConfig.fixture("pattern_collision")
	var containment = SeedConfig.fixture("hearth_containment")
	var match_end = SeedConfig.fixture("match_end")

	assert_eq(growth.state, "opening_growth")
	assert_gt(collision.instability_events.size(), 0)
	assert_eq(containment.capture_state.state, "contained")
	assert_eq(match_end.winner, "player")


func test_readme_documents_playable_seed_and_debug_overlays() -> void:
	var readme := FileAccess.open("res://README.md", FileAccess.READ).get_as_text()

	assert_true(readme.contains("flaghack-opening-growth"))
	assert_true(readme.contains("pattern-collision"))
	assert_true(readme.contains("Hearth containment"))
	assert_true(readme.contains("Debug Overlays"))
