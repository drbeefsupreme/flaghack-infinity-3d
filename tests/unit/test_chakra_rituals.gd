extends GutTest

const MatchState = preload("res://scripts/sim/match_state.gd")
const ChakraRitual = preload("res://scripts/sim/chakra_ritual.gd")

func test_chakra_ritual_spends_ritual_and_unlocks_ability() -> void:
	var state = MatchState.new_default("ritual-seed")
	state.factions["player"].ritual = 3
	var ritual = ChakraRitual.new()

	var result: Dictionary = ritual.complete(state, "player", "priority_beacon", 2, 4)

	assert_true(result.ok)
	assert_eq(state.factions["player"].ritual, 1)
	assert_true(state.factions["player"].unlocked_ability_ids.has("priority_beacon"))


func test_chakra_ritual_can_be_interrupted_without_unlocking() -> void:
	var state = MatchState.new_default("ritual-seed")
	var ritual = ChakraRitual.new()

	var result: Dictionary = ritual.interrupt(state, "player", "priority_beacon", 4)

	assert_true(result.ok)
	assert_false(state.factions["player"].unlocked_ability_ids.has("priority_beacon"))
