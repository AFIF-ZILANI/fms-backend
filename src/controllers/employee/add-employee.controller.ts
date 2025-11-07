import { prisma } from "@/utils/db";
import type { IEmployee } from "@/types";
import { throwError } from "@/utils/error";
import type { Request, Response } from "express";
import { sendSuccessResponse } from "@/utils/apiResponse";
import { ContactMethod, EmployeeRole } from "@/types/enum.type";

export async function AddEmployee(req: Request, res: Response) {
    const {
        name,
        email,
        photo,
        mobile,
        salary,
        joined_date,
        address,
        role,
        online_contact,
    }: IEmployee = req.body;

    console.log(req.body);

    if (
        !name ||
        !mobile ||
        !salary ||
        !joined_date ||
        !role ||
        !online_contact
    ) {
        throwError({ statusCode: 400, message: "Missing required fields" });
    }
    if (!Object.values(EmployeeRole).includes(role)) {
        throwError({ statusCode: 400, message: "Invalid role" });
    }
    online_contact.forEach((method) => {
        if (!Object.values(ContactMethod).includes(method)) {
            throwError({ statusCode: 400, message: "Invalid contact method" });
        }
    });

    if (salary <= 0) {
        throwError({
            statusCode: 400,
            message: "Salary must be greater than 0",
        });
    }
    const joinedDate = new Date(joined_date);
    if (isNaN(joinedDate.getTime())) {
        throwError({ statusCode: 400, message: "Invalid joined date" });
    }

    if (!photo?.image_url || !photo.public_id) {
        throwError({
            message: "Employee Image is requilred, some fields are missing!",
            statusCode: 400,
        });
    }

    const exsistEmployee = await prisma.employee.findFirst({
        where: {
            OR: [{ email: email || undefined }, { mobile }],
        },
    });

    if (exsistEmployee) {
        throwError({ statusCode: 400, message: "Employee already exists" });
    }

    const avatar = await prisma.images.create({
        data: {
            public_id: photo.public_id,
            image_url: photo.image_url,
        },
    });

    console.log(avatar);

    const newEmployee = await prisma.employee.create({
        data: {
            name,
            email: email,
            avatar: {
                connect: { id: avatar.id },
            },
            mobile,
            address,
            salary,
            join_date: joinedDate,
            role,
            online_contact,
        },
    });

    console.log(newEmployee);
    if (!newEmployee) {
        throwError({ statusCode: 500, message: "Failed to create employee" });
    }

    return sendSuccessResponse({
        response: res,
        data: newEmployee,
        message: "Employee created successfully",
    });
}
