extends Node
class_name RealtimeVoiceClient

signal connection_status_changed(status: String)
signal gateway_event(event: Dictionary)
signal audio_packet_received(packet: PackedByteArray)

const VOICE_GATEWAY_URL := "ws://127.0.0.1:3000/voice/realtime/ws"
const CODEC := "opus"
const SAMPLE_RATE_HZ := 48000
const CLIENT_TARGET := "quest3-godot"
const FRAME_VOICE_START := "voice.start"
const FRAME_VOICE_STOP := "voice.stop"
const FRAME_AUDIO_METADATA := "voice.audio_metadata"
const EXPECTED_GATEWAY_EVENTS := ["backend.ready", "backend.error", "voice.started", "voice.stopped", "audio.chunk", "transcript.partial", "transcript.final"]

var gateway_url := VOICE_GATEWAY_URL
var socket := WebSocketPeer.new()
var last_status := "idle"
var next_chunk_index := 0

func connect_gateway(url: String = VOICE_GATEWAY_URL) -> int:
	gateway_url = url
	var error := socket.connect_to_url(gateway_url)
	if error == OK:
		_set_status("connecting")
	return error

func _process(_delta: float) -> void:
	socket.poll()
	_update_connection_status()

	while socket.get_available_packet_count() > 0:
		var packet := socket.get_packet()
		if socket.was_string_packet():
			_handle_json_packet(packet.get_string_from_utf8())
		else:
			audio_packet_received.emit(packet)

func start_session() -> void:
	next_chunk_index = 0
	_send_json({
		"type": FRAME_VOICE_START,
		"codec": CODEC,
		"sampleRateHz": SAMPLE_RATE_HZ,
		"client": CLIENT_TARGET,
	})

func stop_session() -> void:
	_send_json({ "type": FRAME_VOICE_STOP, "client": CLIENT_TARGET })
	socket.close()
	_set_status("closed")

func send_encoded_audio_packet(packet: PackedByteArray) -> void:
	if socket.get_ready_state() == WebSocketPeer.STATE_OPEN:
		_send_json({
			"type": FRAME_AUDIO_METADATA,
			"chunkIndex": next_chunk_index,
			"byteLength": packet.size(),
			"codec": CODEC,
			"clientSentAtMs": Time.get_ticks_msec(),
		})
		socket.put_packet(packet)
		next_chunk_index += 1

func send_transport_probe() -> void:
	var packet := PackedByteArray()
	packet.resize(320)
	for index in range(packet.size()):
		packet[index] = index % 251
	send_encoded_audio_packet(packet)

func _send_json(payload: Dictionary) -> void:
	if socket.get_ready_state() == WebSocketPeer.STATE_OPEN:
		socket.send_text(JSON.stringify(payload))

func _handle_json_packet(text: String) -> void:
	var parsed = JSON.parse_string(text)
	if typeof(parsed) == TYPE_DICTIONARY:
		var event_type := str(parsed.get("type", ""))
		if event_type == "" or EXPECTED_GATEWAY_EVENTS.has(event_type):
			gateway_event.emit(parsed)

func _update_connection_status() -> void:
	var state := socket.get_ready_state()
	if state == WebSocketPeer.STATE_OPEN:
		_set_status("open")
	elif state == WebSocketPeer.STATE_CLOSING:
		_set_status("closing")
	elif state == WebSocketPeer.STATE_CLOSED and last_status != "idle":
		_set_status("closed")

func _set_status(status: String) -> void:
	if status != last_status:
		last_status = status
		connection_status_changed.emit(status)
