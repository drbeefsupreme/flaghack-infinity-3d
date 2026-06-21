class_name NPCStrategyProfile
extends RefCounted

var id: String = "balanced"
var expand_weight: float = 1.0
var defend_weight: float = 1.0
var build_weight: float = 1.0
var raid_weight: float = 0.5
var drug_usage: bool = false

func _init(profile_id: String = "balanced") -> void:
	id = profile_id


static func default_for(faction_id: String) -> NPCStrategyProfile:
	match faction_id:
		"rival_brewer":
			var brewer := NPCStrategyProfile.new("brewer")
			brewer.expand_weight = 0.9
			brewer.build_weight = 1.4
			brewer.drug_usage = true
			return brewer
		"rival_warden":
			var warden := NPCStrategyProfile.new("warden")
			warden.expand_weight = 0.8
			warden.defend_weight = 1.5
			warden.raid_weight = 0.8
			return warden
		_:
			return expand_heavy()


static func expand_heavy() -> NPCStrategyProfile:
	var profile := NPCStrategyProfile.new("expand_heavy")
	profile.expand_weight = 1.5
	profile.raid_weight = 0.1
	return profile


static func raid_heavy() -> NPCStrategyProfile:
	var profile := NPCStrategyProfile.new("raid_heavy")
	profile.expand_weight = 0.2
	profile.raid_weight = 2.0
	return profile
