class_name AttentionPool
extends RefCounted

func reserve(state: MatchState, faction_id: String, amount: int) -> bool:
	return state.spend_attention(faction_id, amount)


func refund(state: MatchState, faction_id: String, amount: int) -> void:
	state.refund_attention(faction_id, amount)
