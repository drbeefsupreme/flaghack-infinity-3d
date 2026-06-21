extends GutTest

const MatchState = preload("res://scripts/sim/match_state.gd")
const AttentionPool = preload("res://scripts/sim/attention_pool.gd")

func test_attention_pool_reserves_and_refunds() -> void:
	var state = MatchState.new_default("attention-seed")
	var pool = AttentionPool.new()

	assert_true(pool.reserve(state, "player", 4))
	assert_eq(state.factions["player"].attention_available, 6)
	assert_false(pool.reserve(state, "player", 99))
	pool.refund(state, "player", 2)
	assert_eq(state.factions["player"].attention_available, 8)
