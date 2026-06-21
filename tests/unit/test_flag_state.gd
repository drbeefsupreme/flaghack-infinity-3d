extends GutTest

const FlagState = preload("res://scripts/sim/flag_state.gd")

func test_flag_tracks_movement_history() -> void:
	var flag = FlagState.new("flag_1", "player")
	flag.mark_carried("vex_player", 1)
	flag.mark_placed(Vector2i(2, 3), 2)
	flag.mark_carried("hippie_1", 3)
	flag.mark_dropped(Vector2i(4, 4), 4)

	assert_eq(flag.movement_history.size(), 4)
	assert_eq(flag.movement_history[0].action, "carried")
	assert_eq(flag.movement_history[1].cell, Vector2i(2, 3))
	assert_eq(flag.cell, Vector2i(4, 4))
	assert_eq(flag.carried_by, "")
