extends GutTest

const MatchState = preload("res://scripts/sim/match_state.gd")
const ContentLoader = preload("res://scripts/sim/content_loader.gd")

func test_ability_requires_unlock_and_enforces_cooldown_cost_and_target() -> void:
	var state = MatchState.new_default("ability-seed")
	var ability = ContentLoader.new().load_abilities()["priority_beacon"]

	assert_eq(ability.apply(state, "player", Vector2i(6, 6), 1).error, "ability_locked")
	state.factions["player"].unlocked_ability_ids.append("priority_beacon")

	var result: Dictionary = ability.apply(state, "player", Vector2i(6, 6), 1)
	assert_true(result.ok)
	assert_eq(state.factions["player"].attention_available, 9)
	assert_eq(ability.apply(state, "player", Vector2i(7, 7), 2).error, "cooldown")
	assert_eq(ability.apply(state, "player", Vector2i(-1, 7), 10).error, "invalid_target")
	assert_eq(state.events.back().type, "ability_used")
