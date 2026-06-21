class_name JobAssignment
extends RefCounted

func claim_next_job(state: MatchState, hippie_id: String) -> String:
	if not state.hippies.has(hippie_id):
		return ""
	var hippie: HippieState = state.hippies[hippie_id]
	if hippie.job_id != "":
		return hippie.job_id

	var job_ids: Array = state.jobs.keys()
	job_ids.sort_custom(func(a: String, b: String) -> bool:
		return _job_sort_key(state.jobs[a]) < _job_sort_key(state.jobs[b])
	)

	for job_id: String in job_ids:
		var job: Dictionary = state.jobs[job_id]
		if job.faction_id == hippie.faction_id and job.status == "open" and job.claimed_by == "":
			job.claimed_by = hippie_id
			job.status = "claimed"
			hippie.job_id = job_id
			state.emit_event("job_claimed", state.tick, {"job_id": job_id, "hippie_id": hippie_id})
			return job_id
	return ""


func complete_claimed_job(state: MatchState, hippie_id: String, event_tick: int) -> Dictionary:
	if not state.hippies.has(hippie_id):
		return {"ok": false, "status": "unknown_hippie"}
	var hippie: HippieState = state.hippies[hippie_id]
	if hippie.job_id == "":
		return {"ok": false, "status": "no_job"}
	if hippie.distracted_ticks > 0:
		hippie.distracted_ticks -= 1
		return {"ok": true, "status": "delayed"}

	var job: Dictionary = state.jobs[hippie.job_id]
	match job.kind:
		"survey":
			return _complete_survey_job(state, hippie, job, event_tick)
		"defend":
			job.status = "complete"
			hippie.job_id = ""
			state.emit_event("hearth_defended", event_tick, {"job_id": job.id, "hippie_id": hippie.id})
			return {"ok": true, "status": "completed"}
		_:
			return {"ok": false, "status": "unknown_job_kind"}


func _complete_survey_job(state: MatchState, hippie: HippieState, job: Dictionary, event_tick: int) -> Dictionary:
	for flag in state.flags.values():
		if flag.cell == job.target_cell and flag.carried_by == "":
			job.status = "complete"
			hippie.job_id = ""
			state.refund_attention(job.faction_id, int(job.attention))
			state.emit_event("survey_job_completed", event_tick, {"job_id": job.id, "flag_id": flag.id})
			return {"ok": true, "status": "completed"}

	var flag_id := state.claim_inventory_flag(job.faction_id, hippie.id)
	if flag_id == "":
		job.status = "blocked_no_flag"
		job.claimed_by = ""
		hippie.job_id = ""
		state.refund_attention(job.faction_id, int(job.attention))
		state.emit_event("job_blocked_no_flag", event_tick, {"job_id": job.id})
		return {"ok": false, "status": "blocked_no_flag"}

	hippie.carrying_flag_id = flag_id
	state.place_carried_flag(flag_id, job.target_cell, event_tick)
	hippie.carrying_flag_id = ""
	job.status = "complete"
	hippie.job_id = ""
	state.refund_attention(job.faction_id, int(job.attention))
	state.emit_event("survey_job_completed", event_tick, {"job_id": job.id, "flag_id": flag_id})
	return {"ok": true, "status": "completed"}


func _job_sort_key(job: Dictionary) -> String:
	var priority := 5
	match String(job.kind):
		"defend":
			priority = 0
		"survey":
			priority = 2
		"raid":
			priority = 3
	return "%02d:%s" % [priority, String(job.id)]
