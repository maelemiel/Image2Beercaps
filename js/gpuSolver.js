// WebGPU Accelerated Linear Assignment Solver
// Implements high-performance Bertsekas Jacobi Auction algorithm with epsilon-scaling on GPU compute shaders

let gpuDevice = null;
let gpuAdapter = null;
let gpuAdapterInfo = null;
let gpuInitAttempted = false;
let gpuInitPromise = null;

let initPipeline = null;
let biddingPipeline = null;
let resolutionPipeline = null;

/**
 * WGSL Shader source for initialization pass
 */
const INIT_SHADER_WGSL = /* wgsl */ `
struct Params {
    num_rows: u32,
    num_cols: u32,
    eps: f32,
    has_cost_matrix: u32,
    reset_prices: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
};

struct Bid {
    col: i32,
    val: f32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> prices: array<f32>;
@group(0) @binding(2) var<storage, read_write> col_owner: array<i32>;
@group(0) @binding(3) var<storage, read_write> row_assignment: array<i32>;
@group(0) @binding(4) var<storage, read_write> bids: array<Bid>;
@group(0) @binding(5) var<storage, read_write> counter: array<atomic<u32>>;

@compute @workgroup_size(64)
fn init_main(@builtin(global_invocation_id) id: vec3<u32>) {
    let idx = id.x;
    if (idx < params.num_rows) {
        row_assignment[idx] = -1;
        bids[idx].col = -1;
        bids[idx].val = 0.0;
    }
    if (idx < params.num_cols) {
        col_owner[idx] = -1;
        if (params.reset_prices == 1u) {
            prices[idx] = 0.0;
        }
    }
    if (idx == 0u) {
        atomicStore(&counter[0], params.num_rows);
    }
}
`;

/**
 * WGSL Shader source for bidding pass
 */
const BIDDING_SHADER_WGSL = /* wgsl */ `
struct Params {
    num_rows: u32,
    num_cols: u32,
    eps: f32,
    has_cost_matrix: u32,
    reset_prices: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
};

struct Bid {
    col: i32,
    val: f32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> cell_colors: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> cap_colors: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> cost_matrix: array<f32>;
@group(0) @binding(4) var<storage, read> prices: array<f32>;
@group(0) @binding(5) var<storage, read> row_assignment: array<i32>;
@group(0) @binding(6) var<storage, read_write> bids: array<Bid>;

fn compute_color_dist(c1: vec4<f32>, c2: vec4<f32>) -> f32 {
    let rMean = (c1.r + c2.r) * 0.5;
    let dr = c1.r - c2.r;
    let dg = c1.g - c2.g;
    let db = c1.b - c2.b;
    let w_r = 2.0 + rMean / 256.0;
    let w_b = 2.0 + (255.0 - rMean) / 256.0;
    return sqrt(w_r * dr * dr + 4.0 * dg * dg + w_b * db * db);
}

@compute @workgroup_size(64)
fn bidding_main(@builtin(global_invocation_id) id: vec3<u32>) {
    let row = id.x;
    if (row >= params.num_rows) {
        return;
    }
    if (row_assignment[row] >= 0) {
        bids[row].col = -1;
        return;
    }
    
    let c1 = cell_colors[row];
    var best_j: i32 = -1;
    var v1: f32 = -1e30;
    var v2: f32 = -1e30;
    
    for (var j: u32 = 0u; j < params.num_cols; j = j + 1u) {
        var cost: f32 = 0.0;
        if (params.has_cost_matrix == 1u) {
            cost = cost_matrix[row * params.num_cols + j];
        } else {
            cost = compute_color_dist(c1, cap_colors[j]);
        }
        let val = -cost - prices[j];
        if (val > v1) {
            v2 = v1;
            v1 = val;
            best_j = i32(j);
        } else if (val > v2) {
            v2 = val;
        }
    }
    if (v2 <= -1e29) {
        v2 = v1;
    }
    
    bids[row].col = best_j;
    bids[row].val = prices[u32(best_j)] + (v1 - v2) + params.eps;
}
`;

/**
 * WGSL Shader source for resolution pass
 */
const RESOLUTION_SHADER_WGSL = /* wgsl */ `
struct Params {
    num_rows: u32,
    num_cols: u32,
    eps: f32,
    has_cost_matrix: u32,
    reset_prices: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
};

struct Bid {
    col: i32,
    val: f32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> prices: array<f32>;
@group(0) @binding(2) var<storage, read_write> col_owner: array<i32>;
@group(0) @binding(3) var<storage, read_write> row_assignment: array<i32>;
@group(0) @binding(4) var<storage, read> bids: array<Bid>;
@group(0) @binding(5) var<storage, read_write> counter: array<atomic<u32>>;

@compute @workgroup_size(64)
fn resolution_main(@builtin(global_invocation_id) id: vec3<u32>) {
    let col = id.x;
    if (col >= params.num_cols) {
        return;
    }
    
    var max_bid: f32 = -1e30;
    var best_bidder: i32 = -1;
    
    for (var i: u32 = 0u; i < params.num_rows; i = i + 1u) {
        if (bids[i].col == i32(col)) {
            let bid = bids[i].val;
            if (bid > max_bid) {
                max_bid = bid;
                best_bidder = i32(i);
            }
        }
    }
    
    if (best_bidder >= 0) {
        let prev_owner = col_owner[col];
        if (prev_owner >= 0) {
            row_assignment[prev_owner] = -1;
        } else {
            atomicSub(&counter[0], 1u);
        }
        col_owner[col] = best_bidder;
        row_assignment[best_bidder] = i32(col);
        prices[col] = max_bid;
    }
}
`;

/**
 * Initialize WebGPU device and compute pipelines
 * @returns {Promise<boolean>} True if WebGPU is ready to use, false otherwise
 */
let gpuDiagnostic = null;

export function getGpuDiagnostic() {
    return gpuDiagnostic;
}

/**
 * Initialize WebGPU device and compute pipelines
 * @returns {Promise<boolean>} True if WebGPU is ready to use, false otherwise
 */
export async function initGpu() {
    if (gpuInitAttempted) {
        if (gpuInitPromise) {
            await gpuInitPromise;
        }
        return isGpuReady();
    }

    gpuInitAttempted = true;

    gpuInitPromise = (async () => {
        try {
            if (typeof navigator === 'undefined' || !navigator.gpu) {
                gpuDiagnostic = 'WebGPU is not supported by this browser';
                console.log(gpuDiagnostic);
                return false;
            }

            // Try multiple adapter discovery strategies (high-perf -> default -> low-power -> fallback)
            let adapter = null;
            const configs = [
                { powerPreference: 'high-performance' },
                undefined,
                { powerPreference: 'low-power' },
                { forceFallbackAdapter: true }
            ];

            for (const cfg of configs) {
                try {
                    adapter = await navigator.gpu.requestAdapter(cfg);
                    if (adapter) break;
                } catch {
                    // Try next configuration
                }
            }

            if (!adapter) {
                const isLinux = typeof navigator !== 'undefined' && /Linux/i.test(navigator.userAgent || navigator.platform || '');
                if (isLinux) {
                    gpuDiagnostic = 'WebGPU adapter blocked by Linux browser. Enable Vulkan in chrome://flags/#enable-vulkan or launch with --enable-features=Vulkan';
                } else {
                    gpuDiagnostic = 'No compatible WebGPU hardware adapter found';
                }
                console.warn(gpuDiagnostic);
                return false;
            }

            gpuAdapter = adapter;

            // Get adapter info synchronously (standard in WebGPU)
            try {
                gpuAdapterInfo = adapter.info || (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : null);
            } catch {
                gpuAdapterInfo = null;
            }

            const device = await adapter.requestDevice();
            gpuDevice = device;

            // Handle unexpected device lost
            device.lost.then(info => {
                console.warn('WebGPU device was lost:', info.message);
                gpuDevice = null;
                initPipeline = null;
                biddingPipeline = null;
                resolutionPipeline = null;
            });

            // Compile shaders
            const initModule = device.createShaderModule({
                label: 'Auction Init Module',
                code: INIT_SHADER_WGSL
            });

            const biddingModule = device.createShaderModule({
                label: 'Auction Bidding Module',
                code: BIDDING_SHADER_WGSL
            });

            const resolutionModule = device.createShaderModule({
                label: 'Auction Resolution Module',
                code: RESOLUTION_SHADER_WGSL
            });

            // Create compute pipelines synchronously to prevent async Dawn deadlock on Linux
            initPipeline = device.createComputePipeline({
                label: 'Auction Init Pipeline',
                layout: 'auto',
                compute: {
                    module: initModule,
                    entryPoint: 'init_main'
                }
            });

            biddingPipeline = device.createComputePipeline({
                label: 'Auction Bidding Pipeline',
                layout: 'auto',
                compute: {
                    module: biddingModule,
                    entryPoint: 'bidding_main'
                }
            });

            resolutionPipeline = device.createComputePipeline({
                label: 'Auction Resolution Pipeline',
                layout: 'auto',
                compute: {
                    module: resolutionModule,
                    entryPoint: 'resolution_main'
                }
            });

            const gpuName = gpuAdapterInfo?.description || gpuAdapterInfo?.device || gpuAdapterInfo?.architecture || 'GPU';
            gpuDiagnostic = `Active on ${gpuName}`;
            console.log(`✓ WebGPU compute pipeline initialized successfully on ${gpuName}`);
            return true;
        } catch (error) {
            gpuDiagnostic = `WebGPU initialization failed: ${error.message}`;
            console.warn(gpuDiagnostic);
            gpuDevice = null;
            initPipeline = null;
            biddingPipeline = null;
            resolutionPipeline = null;
            return false;
        }
    })();

    return gpuInitPromise;
}

/**
 * Check if WebGPU is available and initialized
 * @returns {boolean}
 */
export function isGpuReady() {
    return gpuDevice !== null &&
           initPipeline !== null &&
           biddingPipeline !== null &&
           resolutionPipeline !== null;
}

/**
 * Get GPU hardware info
 * @returns {Object}
 */
export function getGpuInfo() {
    return {
        ready: isGpuReady(),
        attempted: gpuInitAttempted,
        name: gpuAdapterInfo?.description || gpuAdapterInfo?.device || gpuAdapterInfo?.architecture || (isGpuReady() ? 'GPU' : 'None'),
        vendor: gpuAdapterInfo?.vendor || '',
        architecture: gpuAdapterInfo?.architecture || ''
    };
}

/**
 * Solve linear assignment for mosaic directly on the GPU
 * Calculates color distances on-the-fly and optimizes assignments using Jacobi Auction
 * 
 * @param {Array<{r: number, g: number, b: number}>} cellColors - Array of target cell colors
 * @param {Array<{r: number, g: number, b: number}>} capColors - Array of cap slot colors
 * @param {Object} options - Configuration options
 * @param {Function} progressCallback - Optional progress reporting callback
 * @returns {Promise<number[]>} Assignment array where result[i] = j means cell i is assigned to cap j
 */
export async function solveMosaicAssignmentGPU(cellColors, capColors, options = {}, progressCallback = null) {
    if (!isGpuReady()) {
        throw new Error('WebGPU is not initialized or ready');
    }

    const numRows = cellColors.length;
    const numCols = capColors.length;

    if (numRows === 0 || numCols === 0) {
        return [];
    }

    return await runGpuAuction({
        numRows,
        numCols,
        cellColors,
        capColors,
        costMatrix: null,
        hasCostMatrix: false,
        options,
        progressCallback
    });
}

/**
 * Solve general linear assignment problem (Hungarian equivalent) on the GPU
 * 
 * @param {number[][]} costMatrix - 2D cost matrix [numRows][numCols]
 * @param {Object} options - Configuration options
 * @param {Function} progressCallback - Optional progress reporting callback
 * @returns {Promise<number[]>} Assignment array where result[i] = j means row i is assigned to col j
 */
export async function hungarianGPU(costMatrix, options = {}, progressCallback = null) {
    if (!isGpuReady()) {
        throw new Error('WebGPU is not initialized or ready');
    }

    const numRows = costMatrix.length;
    const numCols = costMatrix[0]?.length || 0;

    if (numRows === 0 || numCols === 0) {
        return [];
    }

    // Flatten cost matrix to Float32Array
    const flatMatrix = new Float32Array(numRows * numCols);
    for (let i = 0; i < numRows; i++) {
        for (let j = 0; j < numCols; j++) {
            flatMatrix[i * numCols + j] = costMatrix[i][j];
        }
    }

    return await runGpuAuction({
        numRows,
        numCols,
        cellColors: null,
        capColors: null,
        costMatrix: flatMatrix,
        hasCostMatrix: true,
        options,
        progressCallback
    });
}

/**
 * Internal runner for WebGPU Jacobi Auction with epsilon-scaling
 */
async function runGpuAuction({
    numRows,
    numCols,
    cellColors,
    capColors,
    costMatrix,
    hasCostMatrix,
    options = {},
    progressCallback = null
}) {
    const device = gpuDevice;
    const yieldToUI = () => new Promise(resolve => setTimeout(resolve, 0));

    // Target assignments: if numRows <= numCols, target is numRows; otherwise target is numCols
    const targetAssigned = Math.min(numRows, numCols);
    const targetThreshold = numRows - targetAssigned;

    const initialEps = options.initialEps || 2.0;
    const minEps = options.minEps || 0.5;
    const batchSize = options.batchSize || 20;
    const maxIters = options.maxIters || 5000;

    // Buffer sizes
    const paramsBufferSize = 32;
    const cellColorsByteSize = Math.max(16, numRows * 16);
    const capColorsByteSize = Math.max(16, numCols * 16);
    const costMatrixByteSize = hasCostMatrix ? Math.max(16, numRows * numCols * 4) : 16;
    const pricesByteSize = Math.max(16, numCols * 4);
    const colOwnerByteSize = Math.max(16, numCols * 4);
    const rowAssignmentByteSize = Math.max(16, numRows * 4);
    const bidsByteSize = Math.max(16, numRows * 8); // struct Bid { i32, f32 } = 8 bytes
    const counterByteSize = 16;

    // Create GPU Buffers
    const paramsBuffer = device.createBuffer({
        label: 'Auction Params',
        size: paramsBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    const cellColorsBuffer = device.createBuffer({
        label: 'Cell Colors',
        size: cellColorsByteSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });

    const capColorsBuffer = device.createBuffer({
        label: 'Cap Colors',
        size: capColorsByteSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });

    const costMatrixBuffer = device.createBuffer({
        label: 'Cost Matrix',
        size: costMatrixByteSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });

    const pricesBuffer = device.createBuffer({
        label: 'Prices',
        size: pricesByteSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });

    const colOwnerBuffer = device.createBuffer({
        label: 'Col Owner',
        size: colOwnerByteSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });

    const rowAssignmentBuffer = device.createBuffer({
        label: 'Row Assignment',
        size: rowAssignmentByteSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
    });

    const bidsBuffer = device.createBuffer({
        label: 'Bids',
        size: bidsByteSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });

    const counterBuffer = device.createBuffer({
        label: 'Unassigned Counter',
        size: counterByteSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
    });

    const stagingCounterBuffer = device.createBuffer({
        label: 'Staging Counter',
        size: counterByteSize,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
    });

    const stagingAssignmentBuffer = device.createBuffer({
        label: 'Staging Assignment',
        size: rowAssignmentByteSize,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
    });

    try {
        // Upload input data to GPU
        if (!hasCostMatrix) {
            const cellColorsData = new Float32Array(numRows * 4);
            for (let i = 0; i < numRows; i++) {
                cellColorsData[i * 4] = cellColors[i].r;
                cellColorsData[i * 4 + 1] = cellColors[i].g;
                cellColorsData[i * 4 + 2] = cellColors[i].b;
                cellColorsData[i * 4 + 3] = 0;
            }
            device.queue.writeBuffer(cellColorsBuffer, 0, cellColorsData);

            const capColorsData = new Float32Array(numCols * 4);
            for (let j = 0; j < numCols; j++) {
                capColorsData[j * 4] = capColors[j].r;
                capColorsData[j * 4 + 1] = capColors[j].g;
                capColorsData[j * 4 + 2] = capColors[j].b;
                capColorsData[j * 4 + 3] = 0;
            }
            device.queue.writeBuffer(capColorsBuffer, 0, capColorsData);
        } else {
            device.queue.writeBuffer(costMatrixBuffer, 0, costMatrix);
        }

        // Create Bind Groups using pipeline layout
        const initBindGroup = device.createBindGroup({
            label: 'Init Bind Group',
            layout: initPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: paramsBuffer } },
                { binding: 1, resource: { buffer: pricesBuffer } },
                { binding: 2, resource: { buffer: colOwnerBuffer } },
                { binding: 3, resource: { buffer: rowAssignmentBuffer } },
                { binding: 4, resource: { buffer: bidsBuffer } },
                { binding: 5, resource: { buffer: counterBuffer } }
            ]
        });

        const biddingBindGroup = device.createBindGroup({
            label: 'Bidding Bind Group',
            layout: biddingPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: paramsBuffer } },
                { binding: 1, resource: { buffer: cellColorsBuffer } },
                { binding: 2, resource: { buffer: capColorsBuffer } },
                { binding: 3, resource: { buffer: costMatrixBuffer } },
                { binding: 4, resource: { buffer: pricesBuffer } },
                { binding: 5, resource: { buffer: rowAssignmentBuffer } },
                { binding: 6, resource: { buffer: bidsBuffer } }
            ]
        });

        const resolutionBindGroup = device.createBindGroup({
            label: 'Resolution Bind Group',
            layout: resolutionPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: paramsBuffer } },
                { binding: 1, resource: { buffer: pricesBuffer } },
                { binding: 2, resource: { buffer: colOwnerBuffer } },
                { binding: 3, resource: { buffer: rowAssignmentBuffer } },
                { binding: 4, resource: { buffer: bidsBuffer } },
                { binding: 5, resource: { buffer: counterBuffer } }
            ]
        });

        const numInitWorkgroups = Math.ceil(Math.max(numRows, numCols) / 64);
        const numBiddingWorkgroups = Math.ceil(numRows / 64);
        const numResolutionWorkgroups = Math.ceil(numCols / 64);

        let eps = initialEps;
        let isFirstPhase = true;
        let totalIterations = 0;
        let unassignedRemaining = numRows;

        // Scaling loop
        while (eps >= minEps && totalIterations < maxIters) {
            // Write uniform parameters
            const paramsData = new ArrayBuffer(paramsBufferSize);
            const u32View = new Uint32Array(paramsData);
            const f32View = new Float32Array(paramsData);

            u32View[0] = numRows;
            u32View[1] = numCols;
            f32View[2] = eps;
            u32View[3] = hasCostMatrix ? 1 : 0;
            u32View[4] = isFirstPhase ? 1 : 0; // Only reset prices on first phase (warm-start afterwards!)

            device.queue.writeBuffer(paramsBuffer, 0, paramsData);

            // Dispatch Init phase
            const initEncoder = device.createCommandEncoder({ label: 'Init Encoder' });
            const initPass = initEncoder.beginComputePass({ label: 'Init Pass' });
            initPass.setPipeline(initPipeline);
            initPass.setBindGroup(0, initBindGroup);
            initPass.dispatchWorkgroups(numInitWorkgroups);
            initPass.end();
            device.queue.submit([initEncoder.finish()]);

            unassignedRemaining = numRows;

            // Run batches until all target rows assigned in this scaling phase
            while (unassignedRemaining > targetThreshold && totalIterations < maxIters) {
                const currentBatch = Math.min(batchSize, maxIters - totalIterations);
                totalIterations += currentBatch;

                const batchEncoder = device.createCommandEncoder({ label: 'Auction Batch Encoder' });

                for (let b = 0; b < currentBatch; b++) {
                    // Step 1: Bidding pass
                    const biddingPass = batchEncoder.beginComputePass({ label: 'Bidding Pass' });
                    biddingPass.setPipeline(biddingPipeline);
                    biddingPass.setBindGroup(0, biddingBindGroup);
                    biddingPass.dispatchWorkgroups(numBiddingWorkgroups);
                    biddingPass.end();

                    // Step 2: Resolution pass (reads bids written in Step 1)
                    const resolutionPass = batchEncoder.beginComputePass({ label: 'Resolution Pass' });
                    resolutionPass.setPipeline(resolutionPipeline);
                    resolutionPass.setBindGroup(0, resolutionBindGroup);
                    resolutionPass.dispatchWorkgroups(numResolutionWorkgroups);
                    resolutionPass.end();
                }

                // Copy counter to staging buffer for readback
                batchEncoder.copyBufferToBuffer(counterBuffer, 0, stagingCounterBuffer, 0, 4);
                device.queue.submit([batchEncoder.finish()]);

                // Read counter
                await stagingCounterBuffer.mapAsync(GPUMapMode.READ);
                const counterArray = new Uint32Array(stagingCounterBuffer.getMappedRange(0, 4));
                unassignedRemaining = counterArray[0];
                stagingCounterBuffer.unmap();

                if (progressCallback) {
                    const assignedCount = Math.max(0, numRows - unassignedRemaining);
                    const percent = Math.min(99, Math.round(50 + (assignedCount / targetAssigned) * 45));
                    progressCallback(`GPU Optimization: ${assignedCount}/${targetAssigned} caps placed (${percent}%)...`, percent);
                    await yieldToUI();
                }
            }

            isFirstPhase = false;
            eps /= 2;
        }

        // Final assignment readback
        const finalEncoder = device.createCommandEncoder({ label: 'Final Readback Encoder' });
        finalEncoder.copyBufferToBuffer(rowAssignmentBuffer, 0, stagingAssignmentBuffer, 0, numRows * 4);
        device.queue.submit([finalEncoder.finish()]);

        await stagingAssignmentBuffer.mapAsync(GPUMapMode.READ);
        const finalAssignments = new Int32Array(stagingAssignmentBuffer.getMappedRange(0, numRows * 4));
        const assignments = Array.from(finalAssignments);
        stagingAssignmentBuffer.unmap();

        // Handle any remaining unassigned cells (e.g. if capped by maxIters or numCols < numRows)
        handleUnassignedCells(assignments, numRows, numCols, cellColors, capColors, costMatrix, hasCostMatrix);

        console.log(`✓ WebGPU auction completed: ${targetAssigned} assignments in ${totalIterations} GPU iters`);
        return assignments;

    } finally {
        // Destroy transient buffers to free GPU VRAM
        paramsBuffer.destroy();
        cellColorsBuffer.destroy();
        capColorsBuffer.destroy();
        costMatrixBuffer.destroy();
        pricesBuffer.destroy();
        colOwnerBuffer.destroy();
        rowAssignmentBuffer.destroy();
        bidsBuffer.destroy();
        counterBuffer.destroy();
        stagingCounterBuffer.destroy();
        stagingAssignmentBuffer.destroy();
    }
}

/**
 * Greedy post-processing fallback for any rare remaining unassigned cells
 */
function handleUnassignedCells(assignments, numRows, numCols, cellColors, capColors, costMatrix, hasCostMatrix) {
    const assignedCols = new Set();
    const unassignedRows = [];

    for (let i = 0; i < numRows; i++) {
        if (assignments[i] >= 0 && assignments[i] < numCols) {
            assignedCols.add(assignments[i]);
        } else {
            unassignedRows.push(i);
        }
    }

    if (unassignedRows.length === 0) {
        return;
    }

    const availableCols = [];
    for (let j = 0; j < numCols; j++) {
        if (!assignedCols.has(j)) {
            availableCols.push(j);
        }
    }

    for (const row of unassignedRows) {
        if (availableCols.length === 0) break;

        let bestColIdx = 0;
        let bestDist = Infinity;

        for (let idx = 0; idx < availableCols.length; idx++) {
            const col = availableCols[idx];
            let dist;
            if (hasCostMatrix) {
                dist = costMatrix[row * numCols + col];
            } else {
                dist = computeCpuColorDistance(cellColors[row], capColors[col]);
            }
            if (dist < bestDist) {
                bestDist = dist;
                bestColIdx = idx;
            }
        }

        const chosenCol = availableCols.splice(bestColIdx, 1)[0];
        assignments[row] = chosenCol;
    }
}

function computeCpuColorDistance(c1, c2) {
    const rMean = (c1.r + c2.r) / 2;
    const dr = c1.r - c2.r;
    const dg = c1.g - c2.g;
    const db = c1.b - c2.b;
    return Math.sqrt(
        (2 + rMean / 256) * dr * dr +
        4 * dg * dg +
        (2 + (255 - rMean) / 256) * db * db
    );
}
