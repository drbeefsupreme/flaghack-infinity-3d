extends GutTest

const FullMatchRunner = preload("res://scripts/sim/full_match_runner.gd")

func test_seeded_match_reaches_at_least_one_camp_capture() -> void:
	var result: Dictionary = FullMatchRunner.new().run("full-seed")

	assert_true(result.milestones.has("first_capture"))
	assert_gte(result.captured_camps.size(), 1)
	assert_eq(result.captured_camps[0], "camp_rival_surveyor")


func test_seeded_match_reaches_final_hearth_dominance_and_match_end() -> void:
	var result: Dictionary = FullMatchRunner.new().run("full-seed")

	assert_eq(result.winner, "player")
	assert_true(result.match_end_visible)
	assert_true(result.milestones.has("match_end"))


func test_match_exercises_instability_drug_ability_and_building_disruption() -> void:
	var result: Dictionary = FullMatchRunner.new().run("full-seed")

	assert_true(result.milestones.has("instability"))
	assert_true(result.milestones.has("drug_used"))
	assert_true(result.milestones.has("ability_used"))
	assert_true(result.milestones.has("building_disrupted"))
	assert_ne(result.final_state_hash, "")


func test_full_match_records_debug_state_for_milestones() -> void:
	var result: Dictionary = FullMatchRunner.new().run("full-seed")

	assert_true(result.debug_state.has("setup"))
	assert_true(result.debug_state.has("first_expansion"))
	assert_true(result.debug_state.has("first_conflict"))
	assert_true(result.debug_state.has("first_containment"))
	assert_true(result.debug_state.has("match_end"))
