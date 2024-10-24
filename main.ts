import { Plugin } from "obsidian";
import { Timer } from "src/Timer";
import { Controls } from "src/Controls";
import { AudioHandler } from "src/AudioHandler";
import { WhisperSettingsTab } from "src/WhisperSettingsTab";
import { SettingsManager, WhisperSettings } from "src/SettingsManager";
import { NativeAudioRecorder } from "src/AudioRecorder";
import { RecordingStatus, StatusBar } from "src/StatusBar";

export default class Whisper extends Plugin {
	settings: WhisperSettings;
	settingsManager: SettingsManager;
	timer: Timer;
	recorder: NativeAudioRecorder;
	audioHandler: AudioHandler;
	controls: Controls | null = null;
	statusBar: StatusBar;

	async onload() {
		this.settingsManager = new SettingsManager(this);
		this.settings = await this.settingsManager.loadSettings();

		this.addRibbonIcon("activity", "Open recording controls", (evt) => {
			if (!this.controls) {
				this.controls = new Controls(this);
			}
			this.controls.open();
		});

		this.addSettingTab(new WhisperSettingsTab(this.app, this));

		this.timer = new Timer();
		this.audioHandler = new AudioHandler(this);
		this.recorder = new NativeAudioRecorder();

		this.statusBar = new StatusBar(this);

		this.addCommands();
	}

	onunload() {
		if (this.controls) {
			this.controls.close();
		}

		this.statusBar.remove();
	}

	addCommands() {
		this.addCommand({
			id: "start-stop-recording",
			name: "Start/stop recording",
			callback: async () => {
				if (this.statusBar.status !== RecordingStatus.Recording) {
					this.statusBar.updateStatus(RecordingStatus.Recording);
					await this.recorder.startRecording();
				} else {
					this.statusBar.updateStatus(RecordingStatus.Processing);
					const audioBlob = await this.recorder.stopRecording();
					const extension = this.recorder.getMimeType()?.split("/")[1];
					const fileName = `${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`;
					// Use audioBlob to send or save the recorded audio as needed
					await this.audioHandler.sendAudioData(audioBlob, fileName);
					this.statusBar.updateStatus(RecordingStatus.Idle);
				}
			},
		});

		// New command for selecting an audio file through Finder
		this.addCommand({
			id: "select-audio-file",
			name: "Select audio file for transcription",
			callback: () => {
				// Create an input element for file selection
				const fileInput = document.createElement("input");
				fileInput.type = "file";
				fileInput.accept = "audio/*"; // Accept only audio files

				// Handle file selection
				fileInput.onchange = async (event) => {
					const files = (event.target as HTMLInputElement).files;
					if (files && files.length > 0) {
						const file = files[0];
						const fileName = file.name;

						// Define chunk size in bytes (25MB)
						const chunkSize = 25 * 1024 * 1024;
						const numChunks = Math.ceil(file.size / chunkSize);

						for (let i = 0; i < numChunks; i++) {
							const start = i * chunkSize;
							const end = Math.min(start + chunkSize, file.size);
							const audioBlob = file.slice(start, end);

							// Send each chunk
							const transcription = await this.audioHandler.sendAudioData(audioBlob, `${fileName}_chunk_${i}`);

							// Depending on settings, either paste at cursor or create new note
							if (this.settings.appendToCursor) {
								// Paste transcription at cursor in the active document
								const editor = this.app.workspace.activeEditor?.editor;
								if (editor) {
									editor.replaceSelection(transcription);
								}
							} else {
								// Create a new note for each chunk
								const newNote = await this.app.vault.create(
									`${fileName}_chunk_${i}.md`,
									transcription
								);
								await this.app.workspace.openLinkText(newNote.basename, "", false);
							}
						}
					}
				};

				// Programmatically open the file dialog
				fileInput.click();
			},
		});
	}
}
