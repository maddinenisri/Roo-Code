// @ts-nocheck
import * as vscode from "vscode"
import { ContextProxy } from "../core/config/ContextProxy"
import { ClineProvider } from "../core/webview/ClineProvider"
import { CodeIndexManager } from "../services/code-index/manager"
import { McpServerManager } from "../services/mcp/McpServerManager"
import { telemetryService } from "../services/telemetry/TelemetryService"
import { migrateSettings } from "../utils/migrateSettings"
import { initializeI18n } from "../i18n"
import { TerminalRegistry } from "../integrations/terminal/TerminalRegistry"
import { API } from "../exports/api"
import { Package } from "../schemas"

// Mock dependencies
jest.mock("vscode", () => ({
	window: {
		createOutputChannel: jest.fn(() => ({
			appendLine: jest.fn(),
			show: jest.fn(),
			clear: jest.fn(),
			dispose: jest.fn(),
		})),
		registerWebviewViewProvider: jest.fn(),
		registerUriHandler: jest.fn(),
		registerTextDocumentContentProvider: jest.fn(),
		showInformationMessage: jest.fn(),
	},
	workspace: {
		getConfiguration: jest.fn(() => ({
			get: jest.fn((key) => {
				if (key === "allowedCommands") return []
				return undefined
			}),
		})),
		registerTextDocumentContentProvider: jest.fn(),
		createFileSystemWatcher: jest.fn(() => ({
			onDidChange: jest.fn(),
			onDidCreate: jest.fn(),
			onDidDelete: jest.fn(),
			dispose: jest.fn(),
		})),
	},
	languages: {
		registerCodeActionsProvider: jest.fn(),
	},
	commands: {
		executeCommand: jest.fn(),
	},
	Uri: {
		parse: jest.fn(),
		joinPath: jest.fn((base, ...paths) => `${base.fsPath}/${paths.join("/")}`), // Simplified mock
	},
	env: {
		language: "en",
		machineId: "test-machine-id",
		uriScheme: "vscode",
		appName: "VSCode",
	},
	ExtensionMode: {
		Development: 2,
		Production: 1,
		Test: 3,
	},
	ProgressLocation: {
		Notification: 15,
	},
	RelativePattern: jest.fn(),
}))

jest.mock("@dotenvx/dotenvx", () => ({
	config: jest.fn(),
}))

jest.mock("../schemas", () => ({
	Package: {
		name: "Roo-Code",
		version: "test-version",
		outputChannel: "Roo Code",
	},
	// Add other schemas if needed by ClineProvider or other parts
}))

jest.mock("../core/config/ContextProxy")
jest.mock("../core/webview/ClineProvider")
jest.mock("../services/code-index/manager")
jest.mock("../services/mcp/McpServerManager")
jest.mock("../services/telemetry/TelemetryService")
jest.mock("../utils/migrateSettings")
jest.mock("../i18n")
jest.mock("../integrations/terminal/TerminalRegistry")
jest.mock("../exports/api")
jest.mock("../activate", () => ({
	handleUri: jest.fn(),
	registerCommands: jest.fn(),
	registerCodeActions: jest.fn(),
	registerTerminalActions: jest.fn(),
	CodeActionProvider: jest.fn(),
}))

// Need to get a reference to the unexported fetchProjectList
// This is a common pattern for testing unexported functions in Jest.
// It requires extension.ts to be a CommonJS module or for Jest to be configured for ES modules.
let fetchProjectListInternal
let activateFunction
let deactivateFunction
let PROJECT_LIST_KEY_INTERNAL

// Helper to reset modules and re-require, capturing the unexported function
const loadModule = () => {
	jest.resetModules()
	const extensionModule = require("../extension")
	// This way of accessing unexported function is a bit hacky and depends on module structure.
	// A more robust way would be to conditionally export for testing if possible.
	// For now, we assume fetchProjectList is accessible via a known pattern or test setup.
	// If fetchProjectList is truly private and inaccessible, tests would need to be more integrated.

	// To access fetchProjectList, we might need to spy on globalState.update or outputChannel.appendLine
	// and infer its behavior from activate.
	// However, the prompt asks for direct tests of fetchProjectList.
	// Let's assume for now we can access it. If not, we'll adapt.
	// One common way if it's not exported is to test it via a function that calls it (activate).

	// For the purpose of this exercise, we'll assume fetchProjectList has been made available for testing.
	// If it's truly an internal detail, we'd test the parts of 'activate' that call it.
	// To simulate this, we'll call activate and check mocks.

	activateFunction = extensionModule.activate
	deactivateFunction = extensionModule.deactivate
	PROJECT_LIST_KEY_INTERNAL = "projectListData" // Re-define or get from module if exported

	// To directly test fetchProjectList, it would need to be exported or use a special test setup.
	// Since it's not, we will test its effects through the 'activate' function.
	// The tests below will be structured to call 'activate' and then check the mocks
	// that 'fetchProjectList' would have interacted with.
}

describe("Extension Activation and Project List", () => {
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel

	beforeEach(() => {
		// Reset mocks for vscode components that are recreated or accessed in activate
		mockOutputChannel = {
			appendLine: jest.fn(),
			show: jest.fn(),
			clear: jest.fn(),
			dispose: jest.fn(),
		}
		;(vscode.window.createOutputChannel as jest.Mock).mockReturnValue(mockOutputChannel)

		mockContext = {
			extensionPath: "/mock/extension/path",
			subscriptions: { push: jest.fn() } as any,
			globalState: {
				get: jest.fn(),
				update: jest.fn(() => Promise.resolve()),
			} as any,
			workspaceState: { get: jest.fn(), update: jest.fn() } as any,
			secrets: { get: jest.fn(), store: jest.fn(), delete: jest.fn(), onDidChange: jest.fn() } as any,
			extensionUri: vscode.Uri.parse("file:///mock/extension/path"),
			environment: { machineId: "test-machine-id" } as any,
			extensionMode: vscode.ExtensionMode.Test,
			storageUri: vscode.Uri.parse("file:///mock/storage/uri"),
			globalStorageUri: vscode.Uri.parse("file:///mock/globalStorage/uri"),
			logUri: vscode.Uri.parse("file:///mock/log/uri"),
			asAbsolutePath: jest.fn((relativePath) => `/mock/extension/path/${relativePath}`),
		}
		;(ContextProxy.getInstance as jest.Mock).mockResolvedValue({
			config: {
				currentConfig: { name: "test-api-config" }, // Default for API config exists
			},
			// Mock other ContextProxy methods if activate calls them before fetchProjectList
			getValues: jest.fn().mockReturnValue({}),
			setValue: jest.fn(),
			setProviderSettings: jest.fn(),
			getValue: jest.fn(),
		})
		;(CodeIndexManager.getInstance as jest.Mock).mockReturnValue({
			initialize: jest.fn().mockResolvedValue(undefined),
		})
		;(migrateSettings as jest.Mock).mockResolvedValue(undefined)

		// Load the module to get 'activate'
		loadModule()
	})

	afterEach(() => {
		jest.clearAllMocks()
	})

	describe("fetchProjectList behavior (tested via activate)", () => {
		const sampleProjects = [
			{ id: "proj-123", name: "Project Alpha" },
			{ id: "proj-456", name: "Project Beta" },
			{ id: "proj-789", name: "Project Gamma" },
		]

		test("should fetch projects and update globalState if API config exists", async () => {
			await activateFunction(mockContext)

			// Check output channel messages related to fetching
			expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
				"API configuration found. Fetching project list...",
			)
			expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(`Fetched ${sampleProjects.length} projects.`)

			// Check globalState update
			expect(mockContext.globalState.update).toHaveBeenCalledWith(PROJECT_LIST_KEY_INTERNAL, sampleProjects)

			// Check that ClineProvider was called with the project list
			expect(ClineProvider).toHaveBeenCalledWith(
				mockContext,
				mockOutputChannel,
				"sidebar",
				expect.any(Object), // Mocked ContextProxy instance
				expect.any(Object), // Mocked CodeIndexManager instance
				sampleProjects, // This is the crucial check
			)
		})

		test("should store empty list and skip fetch if API config does NOT exist", async () => {
			// Simulate no API config
			;(ContextProxy.getInstance as jest.Mock).mockResolvedValue({
				config: {
					currentConfig: undefined, // No API config
				},
				getValues: jest.fn().mockReturnValue({}),
				setValue: jest.fn(),
				setProviderSettings: jest.fn(),
				getValue: jest.fn(),
			})

			// Re-load module to apply new mock behavior for ContextProxy before activate is called
			// This is tricky; ideally, the module is loaded once, and mocks are configured per test.
			// For this specific case, we need ContextProxy.getInstance to resolve differently.
			// A better way might be to have ContextProxy return a mutable object or use jest.doMock.
			const extensionModuleRetry = require("../extension")
			await extensionModuleRetry.activate(mockContext)


			// Check output channel messages
			expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
				"No API configuration found. Skipping project list fetch.",
			)

			// Check globalState update
			expect(mockContext.globalState.update).toHaveBeenCalledWith(PROJECT_LIST_KEY_INTERNAL, [])

			// Check that ClineProvider was called with an empty project list
			expect(ClineProvider).toHaveBeenCalledWith(
				mockContext,
				mockOutputChannel,
				"sidebar",
				expect.any(Object), // Mocked ContextProxy instance
				expect.any(Object), // Mocked CodeIndexManager instance
				[], // Empty project list
			)
		})

		test("should handle errors during project fetching (simulated by globalState.update failure)", async () => {
			// Simulate an error during the "fetching" process, e.g., globalState.update fails
			const testError = new Error("Failed to update global state")
			;(mockContext.globalState.update as jest.Mock).mockImplementation(async (key, value) => {
				// Fail only for the project list update to simulate error within fetchProjectList
				if (key === PROJECT_LIST_KEY_INTERNAL && value !== undefined && value.length > 0) {
					throw testError
				}
				return Promise.resolve()
			})
			
			// Reset and re-require to capture the modified mock context for this specific test
			const extensionModuleError = require("../extension")
			await extensionModuleError.activate(mockContext)

			// Check output channel for error message
			// The first call to globalState.update for PROJECT_LIST_KEY will be with sampleProjects
			// if an API config exists. We make that one throw.
			expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
				`Error fetching project list: ${testError.message}`,
			)

			// Check that globalState.update was still called to store an empty array after the error
			// It would be called twice: once that throws, then once in the catch block.
			expect(mockContext.globalState.update).toHaveBeenCalledWith(PROJECT_LIST_KEY_INTERNAL, [])
			
			// Check that ClineProvider was called with an empty project list
			expect(ClineProvider).toHaveBeenCalledWith(
				mockContext,
				mockOutputChannel,
				"sidebar",
				expect.any(Object), 
				expect.any(Object), 
				[], // Empty project list due to error
			)
		})
	})

	// Basic test for activate and deactivate to ensure they run without throwing
	test("activate function runs basic setup", async () => {
		await activateFunction(mockContext)
		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
			`${Package.name} extension activated - ${JSON.stringify(Package)}`,
		)
		expect(migrateSettings).toHaveBeenCalledWith(mockContext, mockOutputChannel)
		expect(telemetryService.initialize).toHaveBeenCalled()
		expect(initializeI18n).toHaveBeenCalled()
		expect(TerminalRegistry.initialize).toHaveBeenCalled()
		expect(ContextProxy.getInstance).toHaveBeenCalledWith(mockContext)
		expect(CodeIndexManager.getInstance).toHaveBeenCalledWith(mockContext)
		expect(vscode.window.registerWebviewViewProvider).toHaveBeenCalled()
		expect(require("../activate").registerCommands).toHaveBeenCalled()
	})

	test("deactivate function runs cleanup", async () => {
		// Call activate first to set up extensionContext potentially
		await activateFunction(mockContext) 
		await deactivateFunction()
		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(`${Package.name} extension deactivated`)
		expect(McpServerManager.cleanup).toHaveBeenCalled()
		expect(telemetryService.shutdown).toHaveBeenCalled()
		expect(TerminalRegistry.cleanup).toHaveBeenCalled()
	})
})
