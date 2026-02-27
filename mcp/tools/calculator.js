// Calculator Tool for MCP Server
const { z } = require('zod');
const math = require('mathjs');

// Define the calculator tool
const calculatorTool = {
    name: 'calculator',
    config: {
        title: 'Calculator',
        description: 'A calculator that evaluates mathematical expressions with advanced functions, support for symbolic computation, comes with a large set of built-in functions and constants, and offers an integrated solution to work with different data types like numbers, big numbers, complex numbers, fractions, units, and matrices.',
        inputSchema: {
            expression: z.string().describe('All kind of expressions supported by mathjs for calculation, e.g., "12 / (2.3 + 0.7)", "sin(45 deg) ^ 2", "log(10)", "12.7 cm to inch", "9 / 3 + 2i", "sqrt(16)", and more.')
        }
    },
    execute: async ({ expression }) => {
        try {
            // Validate input
            if (!expression || typeof expression !== 'string') {
                throw new Error('Invalid expression. Please provide a valid mathematical expression.');
            }

            // Evaluate the expression using mathjs for advanced functionality
            const result = math.evaluate(expression);

            return {
                content: [
                    {
                        type: 'text',
                        text: String(result)
                    }
                ]
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error: ${error.message}`
                    }
                ]
            };
        }
    }
};

module.exports = { calculatorTool };
