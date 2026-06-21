class_name HippieBrain
extends RefCounted

const JobAssignmentScript = preload("res://scripts/sim/job_assignment.gd")

var assignment: JobAssignment = JobAssignmentScript.new()

func tick_faction(state: MatchState, faction_id: String, event_tick: int) -> Array[Dictionary]:
	var results: Array[Dictionary] = []
	if not state.factions.has(faction_id):
		return results
	for hippie_id in state.factions[faction_id].hippie_ids:
		results.append(tick_hippie(state, hippie_id, event_tick))
	return results


func tick_hippie(state: MatchState, hippie_id: String, event_tick: int) -> Dictionary:
	if not state.hippies.has(hippie_id):
		return {"ok": false, "status": "unknown_hippie"}
	var hippie: HippieState = state.hippies[hippie_id]
	if hippie.job_id == "":
		assignment.claim_next_job(state, hippie_id)
	if hippie.job_id == "":
		return {"ok": true, "status": "idle"}
	return assignment.complete_claimed_job(state, hippie_id, event_tick)
