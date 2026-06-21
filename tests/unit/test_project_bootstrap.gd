extends GutTest

func test_version_baselines_are_pinned() -> void:
	assert_eq(GameConstants.GODOT_VERSION_BASELINE, "4.6-stable")
	assert_eq(GameConstants.GUT_VERSION_BASELINE, "9.6.0")


func test_placeholder_flag_asset_exists() -> void:
	assert_true(ResourceLoader.exists("res://assets/placeholders/flag.svg"))


func test_main_scene_loads() -> void:
	var packed_scene: PackedScene = load("res://scenes/main/main.tscn")
	assert_not_null(packed_scene)
	var scene: Node = packed_scene.instantiate()
	assert_not_null(scene)
	scene.queue_free()


func test_gut_config_lists_unit_and_integration_dirs() -> void:
	var file := FileAccess.open("res://.gutconfig.json", FileAccess.READ)
	assert_not_null(file)
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	assert_true(parsed is Dictionary)
	assert_has(parsed, "dirs")
	assert_true(parsed["dirs"].has("res://tests/unit"))
	assert_true(parsed["dirs"].has("res://tests/integration"))
