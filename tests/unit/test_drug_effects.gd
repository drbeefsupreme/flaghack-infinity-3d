extends GutTest

const MatchState = preload("res://scripts/sim/match_state.gd")
const ContentLoader = preload("res://scripts/sim/content_loader.gd")
const DrugEffect = preload("res://scripts/sim/drug_effect.gd")

func test_drug_can_be_used_expires_and_contains_benefit_and_risk() -> void:
	var state = MatchState.new_default("drug-seed")
	var saffron = ContentLoader.new().load_drugs()["saffron"]

	var result: Dictionary = saffron.use_on_faction(state, "player", 10)
	assert_true(result.ok)
	assert_eq(result.drug.benefit_key, "ritual_focus")
	assert_eq(result.drug.risk_key, "overstimulation")
	assert_eq(state.factions["player"].active_drugs.size(), 1)

	DrugEffect.expire_drugs(state, "player", 20)
	assert_eq(state.factions["player"].active_drugs.size(), 0)


func test_mutual_exclusion_is_deterministic() -> void:
	var state = MatchState.new_default("drug-seed")
	var drugs: Dictionary = ContentLoader.new().load_drugs()

	assert_true(drugs["luminous_dust"].use_on_faction(state, "player", 1).ok)
	var result: Dictionary = drugs["acid_cop_vision"].use_on_faction(state, "player", 2)

	assert_false(result.ok)
	assert_eq(result.error, "mutually_exclusive")
